import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.config import settings
from app.core.async_utils import blocking as _blocking
from app.services import cancel_registry
from app.services.callback import send_complete, send_progress
from app.services.legacy_render_audio import resolve_legacy_audio
from app.services.media_probe import probe_video
from app.services.ffmpeg import (
    CutRange,
    FFmpegError,
    SegmentAudio,
    _run,
    burn_subtitles,
    cut_and_concat_video,
    mux_soft_subtitles,
    replace_audio,
    srt_to_vtt,
    validate_subtitle_format,
    vtt_to_srt,
)
from app.services.render_validation import (
    RenderValidationRunner,
    ValidationContext,
    first_error_check,
)
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter()
_render_slots = asyncio.Semaphore(settings.render_max_concurrency)


class CutRangeRequest(BaseModel):
    start_ms: int
    end_ms: int


class SegmentAudioRequest(BaseModel):
    segment_id: str
    audio_ref: str
    start_ms: int
    end_ms: int


class SubtitleMaskRequest(BaseModel):
    # Phase 4 v1 mask (docs/16 §7.1): anchor fixed SUBTITLE.
    # PRESET-VIZ (docs/97 §19.16) additive v1.1: style SOLID|BLUR (default
    # SOLID), color #RRGGBB (default #000000), blur_radius 2..20 required for
    # BLUR (forbidden for SOLID — fail-closed mirror of the Spring validator).
    enabled: bool
    anchor: str = "SUBTITLE"
    width_percent: int = Field(ge=20, le=100)
    height_percent: int = Field(ge=5, le=50)
    opacity_percent: int = Field(ge=0, le=100)
    padding_percent: int = Field(ge=0, le=10)
    style: str | None = None
    blur_radius: int | None = Field(default=None, ge=2, le=20)
    color: str | None = None


class LayerGeometryRequest(BaseModel):
    """Layer size plus optional free center coordinates in frame-percent space."""

    model_config = ConfigDict(extra="forbid")

    width_percent: int = Field(ge=20, le=100)
    height_percent: int = Field(ge=5, le=50)
    x_percent: int | None = Field(default=None, ge=0, le=100)
    y_percent: int | None = Field(default=None, ge=0, le=100)


class PresentationLayerStyleRequest(BaseModel):
    """Flat type-specific style — SOLID keys and BLUR key are XOR (fail-closed)."""

    model_config = ConfigDict(extra="forbid")

    color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    opacity_percent: Optional[int] = Field(default=None, ge=0, le=100)
    blur_radius: Optional[int] = Field(default=None, ge=2, le=20)


class PresentationLayerRequest(BaseModel):
    """One v2 presentation overlay layer (docs/97 §19.17 §B).

    Strict shape: unknown keys reject (`extra="forbid"`); the type/style XOR is
    enforced by a model validator so a malformed layer can never reach the
    render pipeline. Rendering itself lands in a later phase — this model only
    accepts and validates the wire.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)
    type: Literal["SOLID", "BLUR"]
    enabled: bool
    z_index: int
    anchor: Literal["SUBTITLE", "TOP", "CENTER", "BOTTOM"]
    geometry: LayerGeometryRequest
    style: PresentationLayerStyleRequest

    @model_validator(mode="after")
    def _enforce_style_xor(self) -> "PresentationLayerRequest":
        if self.type == "SOLID":
            if self.style.blur_radius is not None:
                raise ValueError("SOLID layer must not carry blur_radius")
            if self.style.opacity_percent is None:
                raise ValueError("SOLID layer requires opacity_percent")
        else:  # BLUR
            if self.style.color is not None or self.style.opacity_percent is not None:
                raise ValueError("BLUR layer must not carry color/opacity_percent")
            if self.style.blur_radius is None:
                raise ValueError("BLUR layer requires blur_radius")
        return self


class SubtitleTrackRequest(BaseModel):
    format: str
    content_ref: str
    mode: str
    position: str = "BOTTOM"
    vertical_offset_percent: int = Field(default=0, ge=-30, le=30)
    background_box: bool = True
    # PRESET-VIZ (docs/97 §19.16): #RRGGBBAA text background color for the
    # legacy force_style BackColour; absent → historical &H80000000.
    background_color: Optional[str] = None
    # PRESET-VIZ (docs/97 §19.16) additive: #RRGGBB / #RRGGBBAA text color for
    # the legacy force_style PrimaryColour; absent → historical &H00FFFFFF.
    text_color: Optional[str] = None
    # Phase 3 additive typography (legacy force_style path only; never ASS/styled,
    # never effective for SOFT_SUB). Absent → byte-identical legacy behavior.
    font_size: Optional[int] = Field(default=None, ge=16, le=120)
    bold: Optional[bool] = None
    # V2 contract freeze (docs/97 §19.17 §H): outline subset + presentation
    # layers array. Gated ALL-MATCH by Spring; old workers never receive these.
    outline_width: Optional[int] = Field(default=None, ge=0, le=8)
    outline_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    layers: Optional[List[PresentationLayerRequest]] = Field(default=None, max_length=4)
    # Phase 4 additive mask (HARD_SUB-only; Spring rejects it for SOFT_SUB, the
    # worker also fails closed defensively). Absent → no mask.
    mask: Optional[SubtitleMaskRequest] = None

    @model_validator(mode="after")
    def _layers_cap_and_mode_sanity(self) -> "SubtitleTrackRequest":
        if self.layers:
            if len(self.layers) > 4:  # defensive mirror of MAX_PRESENTATION_LAYERS
                raise ValueError("at most 4 presentation layers are allowed")
        return self


class GenerativeBeatRequest(BaseModel):
    id: str
    source_start_ms: int
    source_end_ms: int
    tts_duration_ms: int
    audio_ref: Optional[str] = None
    visual_strategy: str = "SOURCE_CUT"
    visual_description: Optional[str] = None
    narration_segment: Optional[str] = None


class RenderRequest(BaseModel):
    correlation_id: str
    media_job_id: str
    stage_id: str | None = None
    source_video_ref: str
    cut_ranges: List[CutRangeRequest]
    audio_input_version: str
    audio_source: str
    resolved_audio_ref: str | None = None  # CT9: pre-mixed audio (MIXED_AUDIO path)
    audio_mode: str | None = None          # Legacy: "ORIGINAL" | "DUBBED"
    segment_audios: List[SegmentAudioRequest] | None = None  # Legacy: TTS segments
    subtitle_track: SubtitleTrackRequest
    # OUTPUT-ASPECT (docs/97 §19.19): requested output frame; the worker
    # reframes (blur-pad) BEFORE burning subtitles. Null/absent keeps the
    # source frame (identity — historical behavior). Strict enum — a malformed
    # value fails the request parse instead of reaching the filtergraph.
    output_aspect_ratio: Optional[Literal["ORIGINAL", "16:9", "9:16", "4:3", "1:1"]] = None
    callback_base_url: str
    generative_beats: Optional[List[GenerativeBeatRequest]] = None


class RenderResponse(BaseModel):
    correlation_id: str
    status: str


class CancelResponse(BaseModel):
    correlation_id: str
    status: str


@router.post("/render", response_model=RenderResponse)
async def render_endpoint(req: RenderRequest, background_tasks: BackgroundTasks) -> RenderResponse:
    logger.info("Render request: correlation=%s job=%s", req.correlation_id, req.media_job_id)
    cancel_registry.register(req.correlation_id)
    background_tasks.add_task(process_render, req)
    return RenderResponse(correlation_id=req.correlation_id, status="ACCEPTED")


@router.post("/render/{correlation_id}/cancel", response_model=CancelResponse)
async def cancel_render(correlation_id: str) -> CancelResponse:
    """Graceful cancel: flag in-flight render; worker stops between ffmpeg steps (C5)."""
    was_active = cancel_registry.request_cancel(correlation_id)
    status = "CANCEL_REQUESTED" if was_active else "NOT_FOUND_OR_IDLE"
    logger.info("Cancel render correlation=%s status=%s", correlation_id, status)
    return CancelResponse(correlation_id=correlation_id, status=status)


def _check_cancelled(correlation_id: str) -> None:
    if cancel_registry.is_cancelled(correlation_id):
        raise RenderCancelled(correlation_id)


class RenderCancelled(Exception):
    def __init__(self, correlation_id: str) -> None:
        super().__init__(f"Render cancelled: {correlation_id}")
        self.correlation_id = correlation_id


async def process_render(req: RenderRequest) -> None:
    async with _render_slots:
        await _process_render(req)


async def _process_render(req: RenderRequest) -> None:
    temp_dir = tempfile.mkdtemp(prefix="render_")
    output_ref = None
    srt_ref = None
    vtt_ref = None
    warnings: list[dict] = []
    media_probe = None
    try:
        _check_cancelled(req.correlation_id)
        storage = get_storage()
        await send_progress(req.media_job_id, req.correlation_id, 10, req.stage_id)

        source_path = os.path.join(temp_dir, "source_video")
        await _blocking(storage.download, req.source_video_ref, source_path)
        _check_cancelled(req.correlation_id)

        # Download subtitle. B1.0 (docs/93 §4.6.6): ASS burns as-is — the style is
        # Spring-owned and sidecars are generated+uploaded by Spring at preparation;
        # the worker no longer fabricates placeholder SRT/VTT from ASS. SRT/VTT
        # inputs keep the legacy text-sidecar behavior (C1).
        sub_fmt = validate_subtitle_format(req.subtitle_track.format)
        subtitle_path = os.path.join(temp_dir, f"subtitle.{sub_fmt}")
        await _blocking(storage.download, req.subtitle_track.content_ref, subtitle_path)

        srt_path = None
        vtt_path = None
        if sub_fmt == "srt":
            srt_path = os.path.join(temp_dir, "final.srt")
            vtt_path = os.path.join(temp_dir, "final.vtt")
            shutil.copyfile(subtitle_path, srt_path)
            srt_to_vtt(srt_path, vtt_path)
            burn_input = srt_path
        elif sub_fmt == "vtt":
            srt_path = os.path.join(temp_dir, "final.srt")
            vtt_path = os.path.join(temp_dir, "final.vtt")
            shutil.copyfile(subtitle_path, vtt_path)
            vtt_to_srt(vtt_path, srt_path)
            burn_input = srt_path
        else:
            burn_input = subtitle_path

        cut_ranges = [CutRange(start_ms=r.start_ms, end_ms=r.end_ms) for r in req.cut_ranges]
        if not cut_ranges and not req.generative_beats:
            raise FFmpegError("cut_ranges is empty", "INVALID_INPUT", retryable=False)

        if req.generative_beats:
            from app.services.generative_compose import (
                VisualBeatInput,
                _extract_and_rescale_beat,
                _with_source_probe_diagnostics,
                probe_source_duration,
            )

            beat_video_paths: list[str] = []
            tts_audio_paths: list[str] = []
            audio_ref_by_id = {}
            if req.segment_audios:
                for sa in req.segment_audios:
                    audio_ref_by_id[sa.segment_id] = sa.audio_ref

            await send_progress(req.media_job_id, req.correlation_id, 30, req.stage_id)
            try:
                source_duration_probe = await _blocking(probe_source_duration, source_path)
            except FFmpegError as exc:
                first_beat = req.generative_beats[0]
                diagnostic_beat = VisualBeatInput(
                    id=first_beat.id,
                    narration_segment=first_beat.narration_segment or "",
                    visual_description=first_beat.visual_description,
                    source_start_ms=first_beat.source_start_ms,
                    source_end_ms=first_beat.source_end_ms,
                    visual_strategy=first_beat.visual_strategy or "SOURCE_CUT",
                    tts_duration_ms=first_beat.tts_duration_ms,
                )
                raise _with_source_probe_diagnostics(exc, diagnostic_beat) from exc
            for idx, beat in enumerate(req.generative_beats):
                _check_cancelled(req.correlation_id)
                beat_video_path = os.path.join(temp_dir, f"beat_{beat.id}.mp4")
                vbeat = VisualBeatInput(
                    id=beat.id,
                    narration_segment=beat.narration_segment or "",
                    visual_description=beat.visual_description,
                    source_start_ms=beat.source_start_ms,
                    source_end_ms=beat.source_end_ms,
                    visual_strategy=beat.visual_strategy or "SOURCE_CUT",
                    tts_duration_ms=beat.tts_duration_ms,
                )
                await _blocking(
                    _extract_and_rescale_beat,
                    source_path,
                    vbeat,
                    beat_video_path,
                    temp_dir,
                    source_duration_probe=source_duration_probe,
                )
                beat_video_paths.append(beat_video_path)

                audio_ref = beat.audio_ref or audio_ref_by_id.get(beat.id)
                if audio_ref:
                    raw_audio_path = os.path.join(temp_dir, f"beat_audio_{idx}_raw.wav")
                    await _blocking(storage.download, audio_ref, raw_audio_path)
                    # The measured TTS file is already the beat's timeline
                    # authority. Do not pad it to the source visual duration.
                    tts_audio_paths.append(raw_audio_path)

            await send_progress(req.media_job_id, req.correlation_id, 50, req.stage_id)
            _check_cancelled(req.correlation_id)

            concat_list = os.path.join(temp_dir, "generative_concat_list.txt")
            with open(concat_list, "w", encoding="utf-8") as f:
                for p in beat_video_paths:
                    escaped = p.replace("'", "'\\''")
                    f.write(f"file '{escaped}'\n")
            concat_path = os.path.join(temp_dir, "concat.mp4")
            cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", concat_path]
            await _blocking(_run, cmd)

            warnings = []
            if len(tts_audio_paths) == len(req.generative_beats):
                audio_concat_list = os.path.join(temp_dir, "generative_audio_list.txt")
                with open(audio_concat_list, "w", encoding="utf-8") as f:
                    for p in tts_audio_paths:
                        escaped = p.replace("'", "'\\''")
                        f.write(f"file '{escaped}'\n")
                final_audio_path = os.path.join(temp_dir, "resolved_audio.wav")
                cmd_a = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", audio_concat_list, "-c:a", "pcm_s16le", final_audio_path]
                await _blocking(_run, cmd_a)
            elif req.resolved_audio_ref:
                final_audio_path = os.path.join(temp_dir, "resolved_audio.wav")
                await _blocking(storage.download, req.resolved_audio_ref, final_audio_path)
            else:
                raise FFmpegError("Generative render requires beat audio_refs or resolved_audio_ref", "INVALID_INPUT", retryable=False)
        else:
            await send_progress(req.media_job_id, req.correlation_id, 30, req.stage_id)
            _check_cancelled(req.correlation_id)

            concat_path = os.path.join(temp_dir, "concat.mp4")
            await _blocking(cut_and_concat_video, source_path, cut_ranges, concat_path, temp_dir)
            await send_progress(req.media_job_id, req.correlation_id, 50, req.stage_id)
            _check_cancelled(req.correlation_id)

            # CT9: the resolver owns source selection. Worker validates the
            # discriminator and only executes the selected packaging path.
            if req.audio_input_version != "1":
                raise FFmpegError("Unsupported audio_input_version", "INVALID_INPUT", retryable=False)
            if req.audio_source == "MIXED_AUDIO":
                if not req.resolved_audio_ref:
                    raise FFmpegError("MIXED_AUDIO requires resolved_audio_ref", "INVALID_INPUT", retryable=False)
                # CT9 MIXED_AUDIO path: download pre-mixed audio, pure mux
                logger.info("Render using MIXED_AUDIO path: correlation=%s audio=%s",
                            req.correlation_id, req.resolved_audio_ref)
                final_audio_path = os.path.join(temp_dir, "resolved_audio.wav")
                await _blocking(storage.download, req.resolved_audio_ref, final_audio_path)
                warnings = []
            elif req.audio_source in {"LEGACY_DUBBED", "LEGACY_ORIGINAL"}:
                # Explicit compatibility bridge; the mux path never invents audio.
                segment_audios = [
                    SegmentAudio(
                        segment_id=sa.segment_id,
                        audio_ref=sa.audio_ref,
                        start_ms=sa.start_ms,
                        end_ms=sa.end_ms,
                    )
                    for sa in req.segment_audios
                ] if req.segment_audios else None
                if req.resolved_audio_ref is not None:
                    raise FFmpegError("Legacy audio source must not carry resolved_audio_ref", "INVALID_INPUT", retryable=False)
                try:
                    final_audio_path, warnings = await _blocking(
                        resolve_legacy_audio,
                        req.audio_source,
                        req.audio_mode,
                        segment_audios,
                        source_path,
                        cut_ranges,
                        temp_dir,
                    )
                except ValueError as exc:
                    raise FFmpegError(str(exc), "INVALID_INPUT", retryable=False) from exc
            else:
                raise FFmpegError("Unsupported audio_source", "INVALID_INPUT", retryable=False)

        await send_progress(req.media_job_id, req.correlation_id, 70, req.stage_id)
        _check_cancelled(req.correlation_id)

        audio_replaced = os.path.join(temp_dir, "with_audio.mp4")
        await _blocking(replace_audio, concat_path, final_audio_path, audio_replaced)
        _check_cancelled(req.correlation_id)

        final_video_path = os.path.join(temp_dir, "final.mp4")
        mode = (req.subtitle_track.mode or "SOFT_SUB").upper()
        if mode == "HARD_SUB":
            await _blocking(
                burn_subtitles,
                audio_replaced,
                burn_input,
                final_video_path,
                position=req.subtitle_track.position,
                vertical_offset_percent=req.subtitle_track.vertical_offset_percent,
                background_box=req.subtitle_track.background_box,
                background_color=req.subtitle_track.background_color,
                text_color=req.subtitle_track.text_color,
                subtitle_format=sub_fmt,
                font_size=req.subtitle_track.font_size,
                bold=req.subtitle_track.bold,
                outline_width=req.subtitle_track.outline_width,
                outline_color=req.subtitle_track.outline_color,
                mask=req.subtitle_track.mask.model_dump()
                if req.subtitle_track.mask is not None else None,
                # V2 presentation layers (docs/97 §19.17 §E): authoritative
                # burn overlays; the worker-side precedence ignores the v1
                # mask when layers are present.
                layers=[layer.model_dump() for layer in req.subtitle_track.layers]
                if req.subtitle_track.layers else None,
                # OUTPUT-ASPECT (docs/97 §19.19): reframe (blur-pad) runs FIRST
                # in the filtergraph — subtitle/mask geometry below uses the
                # TARGET frame dims.
                output_aspect_ratio=req.output_aspect_ratio,
            )
        else:
            # Soft-sub: mux subtitle track into MP4 (C1)
            if srt_path is None:
                # ASS never reaches soft-sub from Spring (format=ass implies
                # HARD_SUB); fail closed instead of muxing a None track.
                raise FFmpegError(
                    "Soft-sub requires a text subtitle track",
                    "INVALID_INPUT",
                    retryable=False,
                )
            if req.subtitle_track.mask is not None:
                # Phase 4 (docs/16 §7.1): the mask is a burn-time overlay —
                # it can never apply to the player-controlled mov_text stream.
                # Spring already rejects this at the API; fail closed anyway.
                raise FFmpegError(
                    "mask is not supported with SOFT_SUB",
                    "INVALID_INPUT",
                    retryable=False,
                )
            if req.subtitle_track.layers:
                # V2 presentation layers are burn overlays like the mask —
                # never applicable to a muxed soft-sub track; fail closed.
                raise FFmpegError(
                    "presentation layers are not supported with SOFT_SUB",
                    "INVALID_INPUT",
                    retryable=False,
                )
            try:
                # OUTPUT-ASPECT (docs/97 §19.19): a reframe on the soft-sub path
                # forces a video re-encode inside the mux (copy keeps the source
                # frame); identity keeps the historical stream-copy mux.
                await _blocking(
                    mux_soft_subtitles,
                    audio_replaced,
                    srt_path,
                    final_video_path,
                    output_aspect_ratio=req.output_aspect_ratio,
                )
            except FFmpegError as exc:
                # Phase 0 fail-closed (docs/15 §5.5, TC-PRES-C02): never ship a
                # video without the embedded subtitle stream. The mux failure is
                # retryable by definition (SUBTITLE_MUX_FAILED) so the RENDER
                # retry policy (2 attempts) applies; no validation-late discovery.
                logger.error(
                    "Soft-sub mux failed correlation=%s: %s",
                    req.correlation_id,
                    exc,
                )
                raise FFmpegError(
                    "Soft-sub mux failed",
                    "SUBTITLE_MUX_FAILED",
                    retryable=True,
                ) from exc

        # C0 obtains the canonical probe once; validation consumes it rather
        # than spawning separate ffprobe subprocesses.
        media_probe = await _blocking(probe_video, final_video_path)

        # A2.2a: technical validation before upload — ERROR fails the render
        # (no orphan objects), WARNING passes with the report in the callback.
        validation_context = ValidationContext(
            video_path=final_video_path,
            subtitle_path=burn_input,
            subtitle_format=sub_fmt,
            subtitle_mode=mode,
            expected_duration_ms=(
                sum(
                    b.tts_duration_ms
                    for b in req.generative_beats
                )
                if req.generative_beats
                else sum(r.end_ms - r.start_ms for r in cut_ranges)
            ),
            tolerance_ms=settings.validation_duration_tolerance_ms,
            tolerance_pct=settings.validation_duration_tolerance_pct,
            media_probe=media_probe,
        )
        validation_report = await _blocking(RenderValidationRunner().run, validation_context)
        if not validation_report.passed:
            first_error = first_error_check(validation_report)
            logger.warning(
                "Render validation failed correlation=%s check=%s",
                req.correlation_id,
                first_error.id if first_error else "unknown",
            )
            await send_complete(
                req.media_job_id,
                req.correlation_id,
                "FAILED",
                output_ref=None,
                error={
                    "code": "RENDER_VALIDATION_FAILED",
                    "message": first_error.message if first_error else "render validation failed",
                    "retryable": False,
                },
                warnings=warnings,
                validation=validation_report.to_payload(),
                media_probe=media_probe.to_payload(),
                stage_id=req.stage_id,
            )
            return

        await send_progress(req.media_job_id, req.correlation_id, 90, req.stage_id)
        _check_cancelled(req.correlation_id)

        # Upload video; text sidecars only for SRT/VTT input — ASS sidecars are
        # Spring-owned at preparation (B1.0), callback refs stay null for styled jobs.
        video_key = f"rendered/{req.media_job_id}/{uuid.uuid4()}.mp4"
        output_ref = await _blocking(storage.upload, final_video_path, video_key)

        srt_ref = None
        vtt_ref = None
        if srt_path is not None:
            srt_key = f"rendered/{req.media_job_id}/{uuid.uuid4()}.srt"
            vtt_key = f"rendered/{req.media_job_id}/{uuid.uuid4()}.vtt"
            srt_ref = await _blocking(storage.upload, srt_path, srt_key)
            vtt_ref = await _blocking(storage.upload, vtt_path, vtt_key)

        if cancel_registry.is_cancelled(req.correlation_id):
            # Cancel observed after work finished — still send complete so Spring Boot
            # can flip CANCEL_REQUESTED → CANCELLED (graceful contract).
            await send_complete(
                req.media_job_id,
                req.correlation_id,
                "COMPLETED",
                output_ref=output_ref,
                warnings=warnings,
                srt_ref=srt_ref,
                vtt_ref=vtt_ref,
                validation=validation_report.to_payload(),
                media_probe=media_probe.to_payload(),
                stage_id=req.stage_id,
            )
            return

        await send_complete(
            req.media_job_id,
            req.correlation_id,
            "COMPLETED",
            output_ref=output_ref,
            error=None,
            warnings=warnings,
            srt_ref=srt_ref,
            vtt_ref=vtt_ref,
            validation=validation_report.to_payload(),
            media_probe=media_probe.to_payload(),
            stage_id=req.stage_id,
        )
    except RenderCancelled:
        logger.info("Render cancelled for correlation=%s", req.correlation_id)
        # Do not send complete on mid-pipeline cancel if Spring already set CANCEL_REQUESTED;
        # still send so job does not hang if cancel arrived only at worker.
        await send_complete(
            req.media_job_id,
            req.correlation_id,
            "FAILED",
            output_ref=None,
            error={"code": "CANCELLED", "message": "Render cancelled by user", "retryable": False},
            warnings=warnings,
            stage_id=req.stage_id,
        )
    except FFmpegError as exc:
        logger.exception("Render failed (ffmpeg)")
        error = {"code": exc.code, "message": str(exc), "retryable": exc.retryable}
        if exc.details is not None:
            error["details"] = exc.details
        await send_complete(
            req.media_job_id,
            req.correlation_id,
            "FAILED",
            output_ref=None,
            error=error,
            warnings=warnings,
            stage_id=req.stage_id,
        )
    except Exception as exc:
        logger.exception("Render failed")
        code = "RENDER_FAILED"
        message = str(exc)
        lower = message.lower()
        if any(k in lower for k in ("codec", "unsupported", "invalid")):
            code = "CODEC_UNSUPPORTED" if "codec" in lower or "unsupported" in lower else "INVALID_INPUT"
        await send_complete(
            req.media_job_id,
            req.correlation_id,
            "FAILED",
            output_ref=None,
            error={"code": code, "message": message},
            warnings=warnings,
            stage_id=req.stage_id,
        )
    finally:
        cancel_registry.unregister(req.correlation_id)
        _cleanup(temp_dir)


def _cleanup(temp_dir: str) -> None:
    try:
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass
