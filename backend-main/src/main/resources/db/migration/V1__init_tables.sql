-- V1__init_tables.sql
-- transflow_mini — toàn bộ bảng nghiệp vụ, tổng hợp từ docs/Database_Design.md (v3.3).
-- Không có documents/translation_jobs/translation_memory/production*/clip_factory*/platform admin
-- (đã loại bỏ theo SRS §4.3, xem Database_Design.md §11).
-- Thứ tự tạo bảng bám theo Database_Design.md §13 (để tránh vi phạm FK chéo).
-- Index (kể cả UNIQUE INDEX) được tách sang V2__init_indexes.sql, PK/FK/CHECK giữ tại đây.

-- =========================================================================
-- 1. Auth / Workspace / Project
-- =========================================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(320) NOT NULL,
    password_hash   VARCHAR,
    full_name       VARCHAR(200) NOT NULL,
    google_sub      VARCHAR,
    google_linked   BOOLEAN NOT NULL DEFAULT false,
    status          VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_users_auth_method CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(120) NOT NULL,
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Role chỉ tồn tại ở cấp Workspace.
CREATE TABLE workspace_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR NOT NULL CHECK (role IN ('LEAD','MEMBER','CLIENT')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    source_lang     VARCHAR(20),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Assignment Project: KHÔNG có role. Lead mặc định truy cập mọi Project;
-- Member/Client cần row ở đây (Database_Design.md §3).
CREATE TABLE project_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by        UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_id, user_id)
);

-- =========================================================================
-- 2. Bảng độc lập (terms/credit package/platform provider)
-- =========================================================================

CREATE TABLE terms_versions (
    version         VARCHAR PRIMARY KEY,
    content_ref     VARCHAR NOT NULL,
    is_current      BOOLEAN NOT NULL DEFAULT false,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credit_packages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL,
    credit_amount   NUMERIC(14,4) NOT NULL CHECK (credit_amount > 0),
    price_amount    NUMERIC(14,2) NOT NULL CHECK (price_amount > 0),
    price_currency  VARCHAR(3) NOT NULL DEFAULT 'VND',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE platform_ai_providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol        VARCHAR NOT NULL,
    capabilities    VARCHAR[] NOT NULL CHECK (capabilities <@ ARRAY['STT','TRANSLATE','TTS','VISION']::VARCHAR[]),
    base_url        VARCHAR(500) NOT NULL,
    api_key_enc     BYTEA NOT NULL,
    default_model   VARCHAR(200),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- =========================================================================
-- 3. Credit & Thanh toán (phần phụ thuộc users/workspaces)
-- =========================================================================

CREATE TABLE credit_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id),
    balance         NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workspace_billing_configs (
    workspace_id    UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    cost_mode       VARCHAR NOT NULL DEFAULT 'PAY_PER_USER' CHECK (cost_mode IN ('LEAD_PAYS_ALL','PAY_PER_USER')),
    configured_by   UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE credit_pricing_config (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capability              VARCHAR NOT NULL CHECK (capability IN ('STT','TRANSLATE','TTS','SUMMARIZE_SCRIPT','RENDER','VISION')),
    provider_scope          VARCHAR,
    infra_coefficient_x     NUMERIC(10,6) NOT NULL,
    token_coefficient_y     NUMERIC(10,6),
    effective_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now()
);

-- =========================================================================
-- 4. Nguồn AI — BYOK cá nhân + nền tảng
-- =========================================================================

CREATE TABLE user_ai_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    protocol            VARCHAR NOT NULL CHECK (protocol IN (
        'openai_compatible','anthropic','elevenlabs_native','azure_speech','google_speech','dashscope_native'
    )),
    capabilities        VARCHAR[] NOT NULL CHECK (capabilities <@ ARRAY['STT','TRANSLATE','TTS','VISION']::VARCHAR[]),
    base_url            VARCHAR(500) NOT NULL,
    api_key_enc         BYTEA NOT NULL,
    api_key_hint        VARCHAR(20) NOT NULL,
    default_model       VARCHAR(200),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE tts_voices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_source         VARCHAR NOT NULL CHECK (provider_source IN ('USER','PLATFORM')),
    user_provider_id        UUID REFERENCES user_ai_providers(id) ON DELETE CASCADE,
    platform_provider_id    UUID REFERENCES platform_ai_providers(id) ON DELETE CASCADE,
    voice_id                VARCHAR NOT NULL,
    language                VARCHAR NOT NULL,
    languages               VARCHAR[] DEFAULT '{}',
    gender                  VARCHAR DEFAULT 'UNKNOWN' CHECK (gender IN ('MALE','FEMALE','UNKNOWN')),
    is_active               BOOLEAN NOT NULL DEFAULT true,
    cached_at               TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_tts_voice_source CHECK (
        (provider_source = 'USER' AND user_provider_id IS NOT NULL AND platform_provider_id IS NULL) OR
        (provider_source = 'PLATFORM' AND platform_provider_id IS NOT NULL AND user_provider_id IS NULL)
    )
);

-- =========================================================================
-- 5. Preset & Batch (trước media_assets/media_jobs vì được job/batch tham chiếu)
-- =========================================================================

CREATE TABLE media_presets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope           VARCHAR NOT NULL CHECK (scope IN ('SYSTEM','WORKSPACE','PROJECT')),
    workspace_id    UUID REFERENCES workspaces(id),
    project_id      UUID REFERENCES projects(id),
    name            VARCHAR NOT NULL,
    subtitle_style  JSONB NOT NULL,
    voice_config    JSONB NOT NULL DEFAULT '{}',
    render_config   JSONB NOT NULL DEFAULT '{}',
    is_default      BOOLEAN NOT NULL DEFAULT false,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id),
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_preset_scope_owner CHECK (
        (scope = 'SYSTEM' AND workspace_id IS NULL AND project_id IS NULL) OR
        (scope = 'WORKSPACE' AND workspace_id IS NOT NULL AND project_id IS NULL) OR
        (scope = 'PROJECT' AND project_id IS NOT NULL)
    )
);

-- Video Batch Localization — v1.4: đúng 1 target_lang/lô (scalar, không phải mảng).
CREATE TABLE localization_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES workspaces(id),
    project_id          UUID NOT NULL REFERENCES projects(id),
    name                VARCHAR(200),
    source_asset_ids    UUID[] NOT NULL,
    target_lang         VARCHAR NOT NULL,
    shared_config       JSONB NOT NULL DEFAULT '{}',
    status              VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','PROCESSING','PARTIALLY_FAILED','COMPLETED','FAILED','CANCELLED'
    )),
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ DEFAULT now(),
    CHECK (array_length(source_asset_ids, 1) BETWEEN 1 AND 20)
);

-- =========================================================================
-- 6. Media core
-- =========================================================================

CREATE TABLE media_assets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id            UUID NOT NULL REFERENCES workspaces(id),
    project_id              UUID NOT NULL REFERENCES projects(id),
    parent_asset_id         UUID REFERENCES media_assets(id) ON DELETE RESTRICT,
    asset_type              VARCHAR NOT NULL CHECK (asset_type IN (
        'SOURCE_VIDEO','EXTRACTED_AUDIO','SEPARATED_STEM','DUBBED_AUDIO','MIXED_AUDIO',
        'RENDERED_VIDEO','KEYFRAME_IMAGE'
    )),
    storage_provider        VARCHAR NOT NULL,
    bucket_name             VARCHAR NOT NULL,
    object_storage_key      VARCHAR(1000) NOT NULL,
    file_name               VARCHAR(300) NOT NULL,
    mime_type               VARCHAR(150) NOT NULL,
    file_size_bytes         BIGINT NOT NULL CHECK (file_size_bytes >= 0 AND file_size_bytes <= 524288000),
    duration_ms             BIGINT CHECK (duration_ms IS NULL OR duration_ms <= 1800000),
    uploaded_by_user_id     UUID NOT NULL REFERENCES users(id),
    processing_status       VARCHAR NOT NULL CHECK (processing_status IN ('UPLOADED','VALIDATING','READY','FAILED')),
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (storage_provider, bucket_name, object_storage_key)
);

CREATE TABLE media_consents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id),
    root_asset_id   UUID NOT NULL REFERENCES media_assets(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    terms_version   VARCHAR NOT NULL REFERENCES terms_versions(version),
    ip_address      VARCHAR(45),
    consented_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (root_asset_id, terms_version)
);

-- media_jobs — orchestrator duy nhất (Localization + Summarization).
-- selected_proposal_id chưa gắn FK ở đây (vòng lặp với summary_proposals) — thêm ở cuối file bằng ALTER TABLE.
CREATE TABLE media_jobs (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                    UUID NOT NULL REFERENCES workspaces(id),
    project_id                      UUID NOT NULL REFERENCES projects(id),
    root_asset_id                   UUID NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    batch_id                        UUID REFERENCES localization_batches(id) ON DELETE SET NULL,

    recipe_id                       VARCHAR NOT NULL CHECK (recipe_id IN ('localization.full','summary.script_match')),
    processing_mode                 VARCHAR CHECK (processing_mode IN ('TRANSLATE_ONLY','HYBRID')),

    source_language                 VARCHAR,
    target_lang                     VARCHAR NOT NULL,

    status                          VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED'
    )),

    requested_duration_seconds      INT CHECK (requested_duration_seconds > 0),

    selected_proposal_id            UUID,
    source_summary_job_id           UUID REFERENCES media_jobs(id),

    subtitle_mode                   VARCHAR NOT NULL DEFAULT 'SOFT_SUB' CHECK (subtitle_mode IN ('HARD_SUB','SOFT_SUB')),

    output_audio_mode               VARCHAR NOT NULL DEFAULT 'ORIGINAL_ONLY' CHECK (output_audio_mode IN (
        'ORIGINAL_ONLY','DUB_REPLACE','DUB_MIX'
    )),
    source_separation_enabled       BOOLEAN NOT NULL DEFAULT false,

    tts_voice_id                    UUID REFERENCES tts_voices(id),

    visual_context_enabled          BOOLEAN NOT NULL DEFAULT false,

    preset_id                       UUID REFERENCES media_presets(id),
    preset_snapshot                 JSONB NOT NULL DEFAULT '{}',

    workflow_mode                   VARCHAR NOT NULL DEFAULT 'MANUAL' CHECK (workflow_mode IN ('MANUAL','AUTO')),

    performed_by_user_id            UUID NOT NULL REFERENCES users(id),
    created_by_user_id              UUID NOT NULL REFERENCES users(id),
    created_at                      TIMESTAMPTZ DEFAULT now(),
    updated_at                      TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT ck_job_recipe_mode CHECK (
        (recipe_id = 'localization.full' AND processing_mode IN ('TRANSLATE_ONLY','HYBRID')) OR
        (recipe_id = 'summary.script_match' AND processing_mode IS NULL AND requested_duration_seconds IS NOT NULL)
    ),
    CONSTRAINT ck_audio_mode_sep CHECK (output_audio_mode <> 'DUB_MIX' OR source_separation_enabled = true),
    CONSTRAINT ck_audio_mode_voice CHECK ((output_audio_mode = 'ORIGINAL_ONLY') = (tts_voice_id IS NULL)),
    CONSTRAINT ck_source_summary_job CHECK (
        source_summary_job_id IS NULL OR recipe_id = 'summary.script_match'
    )
);
-- Ghi chú (Database_Design.md §6.2): created_by_user_id là nguồn sự thật duy nhất cho authorization
-- QA/checkpoint (SRS §3.3) — immutable ở service layer, không suy ra quyền từ performed_by_user_id.

CREATE TABLE media_job_stages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_job_id        UUID NOT NULL REFERENCES media_jobs(id) ON DELETE CASCADE,
    stage_name          VARCHAR NOT NULL CHECK (stage_name IN (
        'EXTRACT_AUDIO','SOURCE_SEPARATION','STT','SUMMARIZE','TRANSLATE','TTS','AUDIO_MIX','RENDER'
    )),
    stage_order         SMALLINT NOT NULL CHECK (stage_order BETWEEN 1 AND 8),
    status              VARCHAR NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','PROCESSING','COMPLETED','FAILED','STALE','SKIPPED','CANCEL_REQUESTED','CANCELLED'
    )),
    progress_percent    SMALLINT DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    input_ref           JSONB,
    output_ref          JSONB,
    worker_id           VARCHAR,
    attempt_count       SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    execution_time_ms   BIGINT,
    error_message       TEXT,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    UNIQUE (media_job_id, stage_name),
    UNIQUE (media_job_id, stage_order)
);

-- =========================================================================
-- 7. Tóm tắt — Script-first + chọn đoạn khớp
-- =========================================================================

CREATE TABLE summary_proposals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_job_stage_id      UUID NOT NULL REFERENCES media_job_stages(id) ON DELETE CASCADE,
    generated_by            VARCHAR NOT NULL CHECK (generated_by IN ('AI','HUMAN')),
    generation_round        SMALLINT NOT NULL DEFAULT 1 CHECK (generation_round >= 1),
    feedback_text           TEXT,
    script_content          TEXT,
    script_language         VARCHAR,
    reasoning_note          TEXT,
    total_duration_ms       BIGINT CHECK (total_duration_ms >= 0),
    confidence              NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    warnings                JSONB NOT NULL DEFAULT '[]',
    archived_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_proposal_origin_fields CHECK (
        (generated_by = 'AI') OR
        (generated_by = 'HUMAN' AND script_content IS NULL AND script_language IS NULL
                                AND confidence IS NULL AND feedback_text IS NULL)
    )
);

CREATE TABLE summary_proposal_segments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id             UUID NOT NULL REFERENCES summary_proposals(id) ON DELETE CASCADE,
    seq                     INT NOT NULL,
    start_ms                BIGINT NOT NULL,
    end_ms                  BIGINT NOT NULL CHECK (end_ms > start_ms),
    script_excerpt          TEXT,
    source_sentence_refs    JSONB NOT NULL DEFAULT '[]',
    reasoning_note          TEXT,
    created_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (proposal_id, seq)
);

-- Phá vòng lặp FK media_jobs <-> summary_proposals: gắn FK selected_proposal_id sau khi cả hai bảng đã tồn tại.
ALTER TABLE media_jobs
    ADD CONSTRAINT fk_media_jobs_selected_proposal
    FOREIGN KEY (selected_proposal_id) REFERENCES summary_proposals(id) ON DELETE SET NULL;

-- =========================================================================
-- 8. Phụ đề, Glossary, QA
-- =========================================================================

CREATE TABLE subtitle_segments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_job_id        UUID NOT NULL REFERENCES media_jobs(id) ON DELETE CASCADE,
    seq                 INT NOT NULL,
    content_source      VARCHAR NOT NULL CHECK (content_source IN (
        'TRANSLATED_ORIGINAL','AUTHORED_SCRIPT','TRANSLATED_SCRIPT'
    )),
    source_text         TEXT,
    target_text         TEXT NOT NULL,
    start_ms            BIGINT NOT NULL,
    end_ms              BIGINT NOT NULL CHECK (end_ms > start_ms),
    tts_audio_ref       VARCHAR,
    word_timings        JSONB,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (media_job_id, seq)
);

-- 1 bảng thuật ngữ/Project — Translation Memory đã loại khỏi phạm vi (không cần pgvector).
CREATE TABLE glossaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE glossary_terms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    glossary_id     UUID NOT NULL REFERENCES glossaries(id) ON DELETE CASCADE,
    source_term     VARCHAR NOT NULL,
    target_term     VARCHAR NOT NULL,
    target_lang     VARCHAR NOT NULL
);

-- QA: authorization theo job-ownership enforce ở service layer (Database_Design.md §8.3), không CHECK DB.
CREATE TABLE qa_issues (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subtitle_segment_id     UUID NOT NULL REFERENCES subtitle_segments(id) ON DELETE CASCADE,
    issue_type              VARCHAR NOT NULL,
    severity                VARCHAR NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    blocking_actions        VARCHAR[] NOT NULL,
    detail                  JSONB,
    resolved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE qa_issue_overrides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qa_issue_id     UUID NOT NULL REFERENCES qa_issues(id) ON DELETE CASCADE,
    overridden_by   UUID NOT NULL REFERENCES users(id),
    reason          TEXT NOT NULL CHECK (char_length(reason) >= 10),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- =========================================================================
-- 9. Credit transactions/purchases, AI usage, Notification
-- =========================================================================

CREATE TABLE credit_transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id),
    amount                  NUMERIC(14,4) NOT NULL,
    balance_after           NUMERIC(14,4) NOT NULL,
    type                    VARCHAR NOT NULL CHECK (type IN ('INITIAL_GRANT','PACKAGE_PURCHASE','AI_USAGE','ADJUSTMENT')),
    performed_by_user_id    UUID REFERENCES users(id),
    ref_type                VARCHAR,
    ref_id                  UUID,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE credit_package_purchases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    package_id          UUID NOT NULL REFERENCES credit_packages(id),
    credit_amount       NUMERIC(14,4) NOT NULL,
    price_paid          NUMERIC(14,2) NOT NULL,
    payment_reference   VARCHAR,
    purchased_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_usage_logs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id            UUID NOT NULL REFERENCES workspaces(id),
    project_id              UUID NOT NULL REFERENCES projects(id),
    media_job_id            UUID REFERENCES media_jobs(id),
    performed_by_user_id    UUID NOT NULL REFERENCES users(id),
    operation               VARCHAR NOT NULL CHECK (operation IN ('STT','TRANSLATE','TTS','SUMMARIZE_SCRIPT','RENDER','VISION')),
    used_personal_api_key   BOOLEAN NOT NULL,
    input_tokens            INT,
    output_tokens           INT,
    credit_used             NUMERIC(14,4) NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    type            VARCHAR NOT NULL CHECK (type IN (
        'JOB_COMPLETED','JOB_FAILED','JOB_NEEDS_RERUN','BATCH_COMPLETED','BATCH_PARTIALLY_FAILED','BATCH_FAILED'
    )),
    ref_id          UUID,
    message         TEXT NOT NULL,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);
