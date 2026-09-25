-- Platform provider pool (shared keys for every user), provider health, usage attribution
-- and 3-day media retention. See Database_Design.md §5 / §6 / §10.

-- 1. Platform AI provider pool --------------------------------------------------------
ALTER TABLE platform_ai_providers
    ADD COLUMN name              VARCHAR(100),
    ADD COLUMN api_key_hint      VARCHAR(20),
    ADD COLUMN priority          SMALLINT    NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    ADD COLUMN weight            SMALLINT    NOT NULL DEFAULT 1   CHECK (weight BETWEEN 1 AND 100),
    ADD COLUMN tier              VARCHAR(10) NOT NULL DEFAULT 'PAID' CHECK (tier IN ('PAID','FREE')),
    ADD COLUMN health_status     VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (health_status IN ('UNKNOWN','HEALTHY','DOWN')),
    ADD COLUMN last_checked_at   TIMESTAMPTZ,
    ADD COLUMN last_error_code   VARCHAR(80),
    ADD COLUMN updated_at        TIMESTAMPTZ DEFAULT now();

UPDATE platform_ai_providers SET name = protocol || ' (' || array_to_string(capabilities, ',') || ')'
WHERE name IS NULL;
ALTER TABLE platform_ai_providers ALTER COLUMN name SET NOT NULL;

CREATE INDEX ix_platform_ai_providers_pool
    ON platform_ai_providers (is_active, priority);

-- 2. BYOK health (daily key check) -----------------------------------------------------
ALTER TABLE user_ai_providers
    ADD COLUMN health_status     VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (health_status IN ('UNKNOWN','HEALTHY','DOWN')),
    ADD COLUMN last_checked_at   TIMESTAMPTZ,
    ADD COLUMN last_error_code   VARCHAR(80);

-- 3. Which provider served each AI usage row (platform or user provider id; no FK — either table)
ALTER TABLE ai_usage_logs ADD COLUMN provider_id UUID;
CREATE INDEX ix_ai_usage_logs_provider ON ai_usage_logs (provider_id, created_at);

-- 4. Media retention: objects older than the retention window are deleted from MinIO;
--    the asset row stays (media_jobs.root_asset_id is ON DELETE RESTRICT) and is marked purged.
ALTER TABLE media_assets ADD COLUMN purged_at TIMESTAMPTZ;
CREATE INDEX ix_media_assets_retention ON media_assets (created_at) WHERE purged_at IS NULL;

-- Reconciler scan: non-terminal jobs by last update.
CREATE INDEX ix_media_jobs_status_updated ON media_jobs (status, updated_at);

-- 5. New notification types ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'JOB_COMPLETED', 'JOB_FAILED', 'JOB_NEEDS_RERUN', 'JOB_QA_BLOCKED',
    'BATCH_COMPLETED', 'BATCH_PARTIALLY_FAILED', 'BATCH_FAILED',
    'PROVIDER_KEY_INVALID'
));
CREATE INDEX IF NOT EXISTS ix_notifications_created ON notifications (created_at);
