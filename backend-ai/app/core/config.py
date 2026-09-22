"""Runtime configuration for the AI microservice.

Translate/QA/STT/TTS/VISION providers are BYOK and arrive per-request from Spring Boot.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Upstream call tuning (Rule 3).
    request_timeout_seconds: float = 60.0
    # Long-form TEXT calls (summarize, translate) need more headroom because
    # reasoning-capable models (DeepSeek V4, Qwen, …) spend tokens on
    # chain-of-thought before emitting the JSON payload.
    text_request_timeout_seconds: float = 120.0
    # Extractive summaries have a bounded, compact payload.
    summarize_max_tokens: int = 8192
    # NARRATIVE_REVIEW returns exactly one plan with up to twelve sections.
    # Keep this within the lowest verified supported narrative-model limit
    # (DashScope qwen-max/qwen-plus: 8192 output tokens).
    narrative_summarize_max_tokens: int = 8192
    # Translate outputs are short (one segment ≈ one sentence), but
    # reasoning-capable models still spend tokens on chain-of-thought
    # before emitting the JSON payload. Match the summarize budget so
    # ``finish_reason=length`` does not fire on reasoning models.
    translate_max_tokens: int = 8192
    # When True, the summarize gateway passes ``extra_body={"thinking":
    # {"type": "disabled"}}`` to OpenAI-compatible adapters. This is the
    # only documented kill-switch for DeepSeek V4 reasoning. The Zen
    # gateway forwards unknown body fields as-is per OpenAI spec, so this
    # is safe for non-DeepSeek providers too (they ignore the field).
    disable_thinking_for_summarize: bool = True
    # Same kill-switch applied to /ai/translate and /ai/qa. Keeps translate
    # parity with summarize so reasoning-capable models emit JSON directly
    # into ``content`` instead of ``reasoning_content``.
    disable_thinking_for_translate: bool = True
    max_retries: int = 3
    backoff_base_ms: int = 250

    # Source separation (CT7.1). GPU Demucs is preferred; CPU fallback keeps
    # local/CI pipelines executable when CUDA and model weights are absent.
    separation_engine_id: str = "local_demucs"
    separation_model_id: str = "htdemucs"
    separation_demucs_executable: str = "python"
    separation_cpu_fallback: bool = True
    separation_max_input_bytes: int = 500 * 1024 * 1024
    separation_max_input_duration_ms: int = 30 * 60 * 1000
    separation_max_output_size_multiplier: int = 3
    separation_execution_timeout_seconds: float = 15 * 60
    separation_max_concurrent_jobs: int = 1
    media_storage_endpoint: str = "http://localhost:9000"
    media_storage_access_key: str = ""
    media_storage_secret_key: str = ""
    media_storage_bucket: str = "transflow-media"
    media_storage_secure: bool = False

    # ── Capability Execution Platform — A1.2 Piper (Q-M-TTS-03/20, ADR-CEP §93) ──
    # Local zero-key TTS engine. Runs in-process (Inference Gateway), never more
    # than `piper_semaphore` concurrent syntheses (invariant 4, `93` §8).
    piper_semaphore: int = 2
    # Directory containing baked Piper voice models ({model_name}.onnx +
    # {model_name}.onnx.json). Docker image bakes voices at build time
    # (backend-ai/piper/download_voices.py); runtime never downloads.
    piper_voices_dir: str = "piper/voices"

    # ── Capability Execution Platform — A2.1 Generated Asset Cache (Q-M-TTS-09/10) ──
    # Content-addressable cache of synthesized TTS assets in MinIO under
    # `{gen_cache_prefix}/tts/{protocol}/{voice}/{hash}.{ext}` (namespace
    # `generated-assets/v1`, ADR-CEP §10.3). Optimisation layer only — any
    # cache failure falls back to live synthesis; never blocks the pipeline.
    # Build version written as `generator_version` provenance on every object;
    # a mismatch invalidates the entry (get → miss → overwrite same key).
    app_version: str = __version__
    gen_cache_enabled: bool = True
    # LRU cap for the sweeper (docs: 1–2GB; default 1GB).
    gen_cache_cap_bytes: int = 1024 * 1024 * 1024
    # Sweeper cadence (docs: 15–30 min).
    gen_cache_sweep_interval: int = 1800
    # Object namespace — Q-M-TTS-09 exact value; normalized (no edge slashes).
    gen_cache_prefix: str = "generated-assets/v1"
    # Q-M-TTS-10: "refresh-by-size HEAD" — after this TTL the cache re-verifies
    # object presence/size via HEAD; a valid object is still a hit. Not a
    # delete/invalidation TTL.
    gen_cache_ttl_seconds: int = 86400
    # hit_count / last_access in-memory → MinIO metadata flush cadence.
    gen_cache_flush_interval: int = 60

    # TASK 7 — Visual Understanding defaults (requirement 1,4)
    visual_interval_ms: int = 3000
    visual_max_frames: int = 12
    visual_scene_aware: bool = True
    visual_scene_threshold: float = 0.3
    visual_max_total_image_tokens: int = 12000
    visual_cost_per_image_tokens: int = 800
    visual_prompt_version: str = "v1"
    visual_price_per_1k_tokens_usd: float = 0.005

    # Configurable Image / VLM Provider (Visual-TTS Alignment)
    image_provider_enabled: bool = True
    image_provider_type: str = "openai_compatible"
    image_provider_base_url: str = ""
    image_provider_api_key: str = ""
    image_provider_model: str = ""
    image_provider_timeout_ms: int = 60000
    image_provider_max_frames: int = 12
    image_provider_interval_ms: int = 3000

    # Ops.
    log_level: str = "INFO"

    # === DIAGNOSTIC DEBUG MODE ============================================
    # When True, the OpenAI-compatible and DashScope chat adapters log the
    # COMPLETE wire-level request payload and the COMPLETE raw HTTP response
    # body to the "transflow.ai.debug" logger, before any parsing,
    # normalization, truncation, or field selection. Used to answer
    # "did the gateway actually send thinking=disabled?", "did the model
    # return JSON anywhere in the response?", "did the adapter pick the
    # right field?" without further code changes.
    #
    # Set via the DEBUG_LLM_WIRE=1 environment variable (or 1/true/yes/on).
    # Default off — wire dumps include full message bodies and may contain
    # sensitive content. Never enable in production.
    debug_llm_wire: bool = False

    # When true, OR when a request api_key is blank/placeholder, the gateway
    # returns deterministic mock output instead of calling a provider. Lets the service
    # boot and the BE↔AI contract be exercised end-to-end without spending tokens (0.6).
    mock_mode: bool = False

    def key_is_usable(self, api_key: str | None) -> bool:
        """A key is usable only if present and not an obvious placeholder."""
        if not api_key:
            return False
        lowered = api_key.strip().lower()
        return not (
            lowered.startswith("sk-your")
            or lowered.startswith("nvapi-your")
            or lowered.startswith("change-me")
        )


settings = Settings()
