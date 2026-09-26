from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MEDIA_WORKER_",
        env_file=("../.env", ".env"),
        extra="ignore",
    )

    minio_endpoint: str = "http://localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    media_bucket: str = "transflow-media"
    callback_secret: str = "change-me"
    # Shared secret backend-main sends as X-Internal-Token (app.core.internal_auth).
    # Same env name as backend-main/backend-ai; empty = check disabled (local dev only).
    internal_service_token: str = Field(
        default="",
        validation_alias=AliasChoices("MEDIA_WORKER_INTERNAL_SERVICE_TOKEN", "INTERNAL_SERVICE_TOKEN"),
    )
    callback_base_url: str = "http://localhost:8080"
    log_level: str = "INFO"
    # Deployment-visible worker revision (git SHA or release version). This is
    # observability only; capability support remains explicit below.
    revision: str = "unknown"

    # A2.2a Render technical validation (docs/93 v7, Q-M-TTS-15).
    # Logical names VALIDATION_DURATION_TOLERANCE_MS/_PCT; runtime prefix MEDIA_WORKER_.
    validation_duration_tolerance_ms: int = 500
    validation_duration_tolerance_pct: float = 2.0

    # Heavy render work is offloaded to threads but remains deliberately bounded
    # to preserve the worker's previous single-render operational behavior.
    render_max_concurrency: int = Field(default=1, ge=1)

    # B1.0 ASS burn fonts dir (docs/93 §4.6.6): fonts-dejavu-core in the worker
    # image installs DejaVuSans.ttf under /usr/share/fonts/truetype/dejavu.
    subtitle_fonts_dir: str = "/usr/share/fonts/truetype/dejavu"


settings = Settings()
