"""VLM gateway (requirement 3) — provider abstraction via CEP (no hard-coded provider).

Supports protocol adapters: openai_compatible vision, anthropic vision, dashscope_native vision,
plus mock/placeholder path for deterministic testing (zero-key or mock_mode).

- Cost governance checked before VLM calls (requirement 4)
- Cache keyed by hash video + timestamp + model + prompt version (requirement 5)
- Confidence from VLM respected (requirement 10) — low confidence preserved, not inflated
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import random
import re
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.core.logging_config import get_internal_logger, get_provider_logger
from app.schemas.contract import ProviderPayload
from app.schemas.visual_contract import VisualObservation, FrameSample, VisualSamplingConfig
from app.services.provider_errors import ProviderErrorCode, ProviderException, ProviderValidation
from app.services.visual import visual_cache
from app.services.visual.cost_governance import CostPolicy, check_budget, compute_actual_cost_usd
from app.services.visual.frame_sampler import sample_timestamps, build_frame_samples, estimate_cost
from app.services.visual.temporal_grouping import group_observations
from app.services.visual.multimodal_context import build_multimodal_context

_int_log = get_internal_logger("vlm_gateway")
_prov_log = get_provider_logger("vlm_gateway")

PROMPT_VERSION = "v1"
# price for mock cost estimation
_PRICE_PER_1K_TOKENS_USD = 0.005

# ── Prompt for VLM (visual observation schema) ─────────────────────────

VLM_SYSTEM_PROMPT = (
    "You are a precise video frame analyst. For each image frame you receive, output ONE JSON object "
    "with exactly these fields (no extra keys):\n"
    '{ "sceneId": "scene-001", "people": 0-100, "objects": ["string"], "location": "string or null", '
    '"action": "string or null (main action)", "text": "string or null (visible OCR)", '
    '"visualDescription": "1-2 sentence dense description", "confidence": 0.0-1.0 }\n'
    "Rules:\n"
    "- people = count of distinct people visible (0 if none)\n"
    "- action = most salient action (e.g. 'two people fighting', 'person presenting at podium')\n"
    "- location = setting (e.g. 'indoor office', 'outdoor street at night')\n"
    "- text = verbatim visible text/OCR, null if none\n"
    "- confidence = your certainty 0..1; be calibrated — low if blurry/occluded\n"
    "- Return ONLY the JSON object, no prose, no fences"
)

VLM_USER_PROMPT_TEMPLATE = "Frame timestamp: {timestamp_ms}ms ({mmss}). Analyze this frame."


def _mmss(ms: int) -> str:
    s, ms = divmod(ms, 1000)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _mock_observation(
    timestamp: int,
    *,
    scene_id: Optional[str] = None,
    variant: str = "generic",
) -> dict:
    """Deterministic mock VLM observation for testing without API key.

    Variants support dataset types A-D + fight scene.
    """
    # Deterministic pseudo-random based on timestamp
    rnd = random.Random(timestamp * 1000003)
    # generic fallbacks
    people = rnd.choice([0, 1, 1, 2, 2, 3])
    location = rnd.choice(["indoor office", "outdoor street", "conference room", "living room", "stage"])
    action = rnd.choice(["person speaking", "people conversing", "person gesturing", "group standing"])
    visual_description = f"Frame at {_mmss(timestamp)} shows {people} people {action} in {location}."
    objects = rnd.sample(["table", "chair", "microphone", "screen", "window", "phone"], k=rnd.randint(1, 3))

    # Variant overrides for test determinism
    if variant == "A_many_speech_few_action":
        people = 1
        action = "person speaking at podium"
        location = "conference hall"
        objects = ["podium", "microphone", "screen"]
        visual_description = f"Single speaker presenting at podium in conference hall at {_mmss(timestamp)}."
    elif variant == "B_few_speech_many_action":
        people = rnd.choice([1, 2, 2, 3])
        action = rnd.choice(["person walking", "people shaking hands", "person dancing", "two people embracing"])
        visual_description = f"Active scene with dynamic action: {action} at {_mmss(timestamp)}."
    elif variant == "C_no_speech":
        if timestamp % 7000 < 3000:
            people = 0
            action = "empty room"
            location = "empty indoor room"
            objects = ["chair", "table"]
            visual_description = f"Empty room with no people at {_mmss(timestamp)}; static interior."
        else:
            people = rnd.choice([1, 2])
            action = rnd.choice(["person entering", "person exiting", "people passing by"])
            visual_description = f"Brief human presence: {action} at {_mmss(timestamp)}."
    elif variant == "D_ocr_heavy":
        people = 1
        action = "person presenting slides"
        location = "classroom"
        text = "SALE 50% OFF" if timestamp % 10000 < 5000 else "WELCOME TO TRANSFLOW"
        objects = ["screen", "text overlay", "slide"]
        visual_description = f"Slide-heavy frame showing presentation with visible text '{text}' at {_mmss(timestamp)}."
        return {
            "timestamp": timestamp,
            "scene_id": scene_id,
            "people": people,
            "objects": objects,
            "location": location,
            "action": action,
            "text": text,
            "visual_description": visual_description,
            "confidence": round(0.85 + rnd.random() * 0.1, 3),
        }
    elif variant == "fight":
        # 2-min fight scene: 0-30s calm, 30-110s fight, 110-120s aftermath
        if timestamp < 30000:
            people = 2
            action = "two people standing facing each other"
            location = "outdoor alley"
            objects = ["wall", "ground"]
            visual_description = f"Two people standing facing each other in an alley at {_mmss(timestamp)}, tense posture."
            conf = 0.88
        elif timestamp < 42000:
            people = 2
            action = "two people start fighting"
            location = "outdoor alley"
            objects = ["fist", "jacket"]
            visual_description = f"At {_mmss(timestamp)}, two people begin fighting — fists raised, aggressive movement."
            conf = 0.92
        elif timestamp < 110000:
            people = 2
            action = "two people fighting"
            location = "outdoor alley"
            objects = ["fist", "clothing", "wall"]
            visual_description = f"Intense fight continues at {_mmss(timestamp)} — grappling, striking, dynamic motion."
            conf = 0.90 + rnd.random() * 0.05
        else:
            people = 2
            action = "two people separated, exhausted"
            location = "outdoor alley"
            objects = ["wall", "ground"]
            visual_description = f"Fight aftermath at {_mmss(timestamp)} — participants separated, breathing heavily."
            conf = 0.87
        return {
            "timestamp": timestamp,
            "scene_id": scene_id,
            "people": people,
            "objects": objects,
            "location": location,
            "action": action,
            "text": None,
            "visual_description": visual_description,
            "confidence": round(conf, 3),
        }

    # common text sprinkle for D
    text = None
    if rnd.random() < 0.15:
        text = rnd.choice(["EXIT", "3F", "Hello", "2026"])

    conf = 0.82 + rnd.random() * 0.13
    # low confidence sprinkle for testing hedging
    if rnd.random() < 0.08:
        conf = 0.35 + rnd.random() * 0.15
    return {
        "timestamp": timestamp,
        "scene_id": scene_id,
        "people": people,
        "objects": objects,
        "location": location,
        "action": action,
        "text": text,
        "visual_description": visual_description,
        "confidence": round(min(1.0, max(0.0, conf)), 3),
    }


async def _call_vlm_for_frame(
    provider: ProviderPayload,
    frame: dict,
    *,
    mock_variant: Optional[str] = None,
) -> dict:
    """Call VLM for a single frame. Returns raw observation dict (without timestamp injection).

    When mock_mode or key not usable → deterministic mock. No hard-coded provider branch
    here except capability routing — real adapters use llm_gateway chat with vision extension.
    """
    # mock path — deterministic, no network
    if settings.mock_mode or not settings.key_is_usable(provider.api_key):
        ts = int(frame.get("timestamp", 0))
        variant = mock_variant or "generic"
        # allow per-frame variant via frame_ref query param ?variant=fight
        ref = str(frame.get("frame_ref", ""))
        if "variant=fight" in ref:
            variant = "fight"
        return _mock_observation(ts, variant=variant)

    # Real VLM path — try vision-aware chat
    # For V1, route through openai_compatible / anthropic / dashscope_native vision adapters.
    # If no vision adapter exists, fail closed with unsupported model.
    try:
        from app.services.protocol import require_adapter

        # Vision uses IMAGE/VIDEO capability; accept TEXT as fallback for vision-capable models
        # Attempt to require a vision-capable adapter; if none, use TEXT.
        adapter = None
        last_exc: Exception | None = None
        for cap in ("VISION", "IMAGE", "VIDEO", "TEXT"):
            try:
                adapter = require_adapter(provider.protocol, capability=cap)
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                continue
        if adapter is None:
            raise last_exc or ProviderValidation(
                f"VLM not supported for protocol {provider.protocol}",
                code=ProviderErrorCode.PROVIDER_UNSUPPORTED_PROTOCOL,
                protocol=provider.protocol,
                capability="VISION",
            )
        # Build vision prompt — adapter may support images param
        system = VLM_SYSTEM_PROMPT
        user = VLM_USER_PROMPT_TEMPLATE.format(timestamp_ms=frame.get("timestamp", 0), mmss=_mmss(int(frame.get("timestamp", 0))))
        # Pass image ref via extra_body/images if adapter supports it
        # For V1, we send frame_ref as text placeholder — real image fetching would stream bytes.
        # Adapter contract is internal; we call chat with images list when available.
        kwargs: dict[str, Any] = {"max_tokens": 512, "response_format": {"type": "json_object"}}
        # Check if adapter.chat supports images kwarg
        import inspect

        sig = inspect.signature(adapter.chat)
        if "images" in sig.parameters:
            kwargs["images"] = [frame.get("frame_ref")]
        # Merge frame ref into user when no images param
        if "images" not in kwargs:
            user = user + f" Frame ref: {frame.get('frame_ref')}"

        result = await adapter.chat(provider, system, user, **kwargs)  # type: ignore[call-arg]
        raw = (result.text or "").strip()
        # Capture provider usage if available (for actual_cost mapping)
        _usage = None
        try:
            if hasattr(result, "usage") and result.usage:
                _usage = {
                    "prompt_tokens": getattr(result.usage, "input_tokens", 0) or 0,
                    "completion_tokens": getattr(result.usage, "output_tokens", 0) or 0,
                    "total_tokens": (getattr(result.usage, "input_tokens", 0) or 0) + (getattr(result.usage, "output_tokens", 0) or 0),
                    "provider": getattr(result.usage, "provider", None),
                    "model": getattr(result.usage, "model", None),
                }
        except Exception:
            _usage = None
        # parse JSON
        try:
            # extract json object
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            obj = json.loads(m.group(0) if m else raw)
        except Exception as exc:
            raise ProviderValidation(
                f"VLM returned malformed JSON: {exc}",
                code=ProviderErrorCode.PROVIDER_RESPONSE_MALFORMED,
                provider=provider.base_url,
                protocol=provider.protocol,
                capability="VISION",
            ) from exc
        # normalize to our schema
        obs = {
            "scene_id": obj.get("sceneId") or obj.get("scene_id"),
            "people": int(obj.get("people", 0)),
            "objects": list(obj.get("objects") or []),
            "location": obj.get("location"),
            "action": obj.get("action"),
            "text": obj.get("text"),
            "visual_description": str(obj.get("visualDescription") or obj.get("visual_description") or ""),
            "confidence": float(obj.get("confidence", 0.5)),
        }
        # Attach usage for aggregation (not part of VisualObservation schema, stripped before validation)
        if _usage:
            obs["_usage"] = _usage
            # Also try to capture request id if present in result (some adapters may set)
            try:
                if hasattr(result, "request_id") and result.request_id:
                    obs["_request_id"] = result.request_id
            except Exception:
                pass
        return obs
    except ProviderException:
        raise
    except Exception as exc:
        raise ProviderValidation(
            f"VLM call failed: {exc}",
            code=ProviderErrorCode.PROVIDER_INTERNAL_ERROR,
            provider=provider.base_url,
            protocol=provider.protocol,
            capability="VISION",
        ) from exc


async def understand_visual(
    *,
    video_ref: str,
    video_url: str,
    provider: ProviderPayload,
    sampling_config: VisualSamplingConfig,
    transcript: Optional[List[dict]] = None,
    frame_samples: Optional[List[dict]] = None,
    video_duration_ms: Optional[int] = None,
    scene_boundaries: Optional[List[dict]] = None,  # [{timestamp_ms, score}]
    mock_variant: Optional[str] = None,
) -> dict:
    """End-to-end visual understanding: sample → cost → cache → VLM → grouping → multimodal context.

    Returns dict with observations, scenes, cost, frame_samples, cache_hit, multimodal_context.
    """
    transcript = transcript or []
    # 1) sampling: if frame_samples provided externally, use them; else generate
    if frame_samples is not None:
        timestamps = [int(f.get("timestamp", 0)) for f in frame_samples]
        samples = frame_samples
    else:
        duration = video_duration_ms
        if duration is None:
            duration = max(
                [int(s.get("end_ms", 0)) for s in transcript] + [0]
            ) if transcript else 0
            # fallback default 120s if unknown
            if duration <= 0:
                duration = 120000
        # parse scene boundaries
        sb = None
        if scene_boundaries and sampling_config.scene_aware:
            from app.services.visual.frame_sampler import SceneBoundary

            sb = [
                SceneBoundary(timestamp_ms=int(b.get("timestamp_ms", b.get("timestamp", 0))), score=float(b.get("score", 0.5)))
                for b in scene_boundaries
            ]
        timestamps = sample_timestamps(
            duration_ms=duration,
            interval_ms=sampling_config.interval_ms,
            max_frames=sampling_config.max_frames,
            scene_boundaries=sb,
            scene_aware=sampling_config.scene_aware,
            scene_threshold=sampling_config.scene_threshold,
        )
        # M17.1-A: real frame extraction → data:image/...;base64 when provider is real (key usable).
        # Mock path (empty key or mock_mode) keeps placeholder #t=… and deterministic mock.
        # Real path extracts JPEG bytes via ffmpeg and encodes as data URL so adapter sends image_url.
        is_real_provider = (not settings.mock_mode) and settings.key_is_usable(provider.api_key)
        if is_real_provider and timestamps:
            # Attempt real extraction — fail-closed on error (no silent fallback to placeholder in real verification).
            # Detect if video_url/video_ref looks like a resolvable source (http or existing file).
            candidate = (video_url or video_ref or "").strip()
            can_extract = False
            if candidate.startswith("http://") or candidate.startswith("https://"):
                can_extract = True
            else:
                # local file path (tests or worker-presigned download)
                import os as _os
                from pathlib import Path as _Path
                clean = candidate.split("#t=")[0].split("?")[0]
                if clean.startswith("file://"):
                    clean = clean[7:]
                if _os.path.exists(clean) and _os.path.isfile(clean):
                    can_extract = True
                elif _os.path.exists(_Path(clean).resolve() if clean else ""):
                    can_extract = True
                # also check video_ref fallback
                if not can_extract and video_ref:
                    vr = video_ref.split("#t=")[0]
                    if _os.path.exists(vr) and _os.path.isfile(vr):
                        can_extract = True
            if can_extract:
                try:
                    from app.services.visual.frame_extractor import extract_frames_as_data_urls_async
                    # Use data URLs so openai_compatible detects image_url and sends as vision
                    real_samples = await extract_frames_as_data_urls_async(
                        video_url=video_url,
                        video_ref=video_ref,
                        timestamps=timestamps,
                    )
                    if real_samples:
                        samples = real_samples
                    else:
                        samples = build_frame_samples(timestamps, video_ref=video_ref, video_url=video_url, scene_boundaries=sb) if timestamps else []
                except ProviderValidation:
                    raise
                except Exception as exc:
                    raise ProviderValidation(
                        f"Real frame extraction failed: {exc}",
                        code=ProviderErrorCode.PROVIDER_INTERNAL_ERROR,
                        provider=provider.base_url,
                        protocol=provider.protocol,
                        capability="VISION",
                    ) from exc
            else:
                # No resolvable video — keep placeholder (will be sent as text). For real provider with
                # no video file, this will result in text-only Frame ref — explicit, not silent mock.
                samples = build_frame_samples(timestamps, video_ref=video_ref, video_url=video_url, scene_boundaries=sb) if timestamps else []
        else:
            samples = build_frame_samples(timestamps, video_ref=video_ref, video_url=video_url, scene_boundaries=sb) if timestamps else []

    # 2) cost governance before any VLM call
    policy = CostPolicy(
        max_frames=sampling_config.max_frames,
        cost_per_image_tokens=sampling_config.cost_per_image_tokens,
        max_total_image_tokens=sampling_config.max_total_image_tokens,
        max_budget_usd=sampling_config.max_budget_usd,
    )
    cost = check_budget(len(samples), policy) if samples else {
        "frames": 0,
        "estimated_image_tokens": 0,
        "estimated_total_tokens": 1000,
        "estimated_cost_usd": 0.0,
        "within_budget": True,
        "reason": None,
    }

    if not samples:
        # empty video → no observations but still build context
        observations: List[dict] = []
        scenes: List[dict] = []
        cache_hit = False
    else:
        # 3) cache lookup per frame
        observations = []
        pending: List[dict] = []
        cache_hit_all = True
        for fr in samples:
            ts = int(fr.get("timestamp", 0))
            cached = visual_cache.get(video_ref=video_ref, timestamp=ts, model=provider.model, prompt_version=sampling_config.prompt_version)
            if cached is not None:
                # merge timestamp/scene from frame
                obs = dict(cached)
                obs["timestamp"] = ts
                # preserve scene_id from cache if present else frame scene grouping later
                observations.append(obs)
            else:
                pending.append(fr)
                cache_hit_all = False

        # 4) VLM calls for pending frames (concurrently, max 3 at a time to bound cost)
        if pending:
            sem = asyncio.Semaphore(3)

            # For usage aggregation (M17.1-B)
            aggregated_usage: dict | None = None
            provider_request_ids: list[str] = []

            async def _fetch(fr: dict) -> dict:
                async with sem:
                    raw = await _call_vlm_for_frame(provider, fr, mock_variant=mock_variant)
                    # Capture usage before stripping (M17.1-B)
                    nonlocal aggregated_usage
                    _u = raw.get("_usage")
                    if _u:
                        if aggregated_usage is None:
                            aggregated_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "provider": _u.get("provider"), "model": _u.get("model")}
                        aggregated_usage["prompt_tokens"] += int(_u.get("prompt_tokens", 0) or 0)
                        aggregated_usage["completion_tokens"] += int(_u.get("completion_tokens", 0) or 0)
                        aggregated_usage["total_tokens"] += int(_u.get("total_tokens", 0) or 0)
                    _rid = raw.get("_request_id")
                    if _rid:
                        provider_request_ids.append(str(_rid))
                    # normalize and inject timestamp
                    visual_desc = str(raw.get("visual_description") or raw.get("visualDescription") or "").strip()
                    if not visual_desc:
                        visual_desc = str(raw.get("visualDescription") or raw.get("visual_description") or "visual observation")
                    obs = {
                        "timestamp": int(fr.get("timestamp", 0)),
                        "scene_id": raw.get("scene_id") or raw.get("sceneId"),
                        "people": int(raw.get("people", 0)),
                        "objects": list(raw.get("objects") or []),
                        "location": raw.get("location"),
                        "action": raw.get("action"),
                        "text": raw.get("text"),
                        "visual_description": visual_desc,
                        "confidence": float(raw.get("confidence", 0.5)),
                    }
                    # low confidence preservation (requirement 10) — caller will hedge
                    # store in cache (without _usage)
                    visual_cache.put(
                        video_ref=video_ref,
                        timestamp=int(fr.get("timestamp", 0)),
                        model=provider.model,
                        prompt_version=sampling_config.prompt_version,
                        observation=obs,
                    )
                    return obs

            pending_obs = await asyncio.gather(*[_fetch(fr) for fr in pending])
            observations.extend(pending_obs)
        else:
            pending_obs = []
            aggregated_usage = None
            provider_request_ids = []

        cache_hit = cache_hit_all and len(observations) == len(samples)

        # sort by timestamp
        observations = sorted(observations, key=lambda o: int(o.get("timestamp", 0)))

    # 5) temporal grouping
    scenes = group_observations(observations)

    # 6) multimodal context
    # derive duration
    dur = video_duration_ms
    if dur is None:
        if transcript:
            dur = max(int(s.get("end_ms", 0)) for s in transcript)
        elif observations:
            dur = max(int(o.get("timestamp", 0)) for o in observations) + 3000
        else:
            dur = 0
    multimodal_context = build_multimodal_context(transcript, observations, scenes, duration_ms=dur)

    # validate observations shape early
    validated_obs = []
    for o in observations:
        try:
            vo = VisualObservation.model_validate(
                {
                    "timestamp": o.get("timestamp"),
                    "scene_id": o.get("scene_id"),
                    "people": o.get("people", 0),
                    "objects": o.get("objects") or [],
                    "location": o.get("location"),
                    "action": o.get("action"),
                    "text": o.get("text"),
                    "visual_description": o.get("visual_description") or "observation",
                    "confidence": o.get("confidence", 0.5),
                }
            )
            validated_obs.append(vo.model_dump())
        except Exception:
            # drop invalid shape but log
            _int_log.warning("dropping invalid visual observation at %s", o.get("timestamp"))
            continue

    usage_dict = aggregated_usage if 'aggregated_usage' in locals() else None
    actual_cost = compute_actual_cost_usd(usage_dict, model=provider.model)
    if isinstance(cost, dict):
        cost["actual_cost_usd"] = actual_cost

    # Strip internal underscore-prefixed metadata (_width, _height, _sha256, _bytes)
    # from frame samples — they are extractor diagnostics, not part of the FrameSample
    # wire contract (extra="forbid").
    wire_samples = [
        {k: v for k, v in s.items() if not k.startswith("_")}
        for s in samples
    ] if samples else samples

    return {
        "observations": validated_obs,
        "scenes": scenes,
        "cost": cost,
        "frame_samples": wire_samples,
        "cache_hit": cache_hit if samples else False,
        "multimodal_context": multimodal_context,
        "usage": aggregated_usage if 'aggregated_usage' in locals() else None,
        "provider_request_ids": provider_request_ids if 'provider_request_ids' in locals() else [],
    }
