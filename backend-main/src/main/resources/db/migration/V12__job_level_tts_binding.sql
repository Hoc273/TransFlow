-- =====================================================================
-- V12: Job-Level TTS Provider & Voice Binding (ADR-CEP Phase B)
--
-- Adds tts_provider_id (UUID) to media_jobs.
-- Adds fk_media_jobs_tts_voice constraint on tts_voice_id referencing tts_voices(id).
-- Creates indexes on tts_provider_id and tts_voice_id.
-- Performs deterministic single-match backfill for jobs with existing tts_voice_id.
-- Enforces ck_media_jobs_tts_binding check constraint: (tts_provider_id IS NULL) = (tts_voice_id IS NULL).
-- =====================================================================

ALTER TABLE media_jobs
    ADD COLUMN IF NOT EXISTS tts_provider_id UUID;

-- Ensure FK for tts_voice_id -> tts_voices(id) with ON DELETE SET NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'media_jobs' AND constraint_name = 'fk_media_jobs_tts_voice'
    ) THEN
        ALTER TABLE media_jobs
            ADD CONSTRAINT fk_media_jobs_tts_voice
            FOREIGN KEY (tts_voice_id)
            REFERENCES tts_voices (id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_jobs_tts_provider
    ON media_jobs (tts_provider_id);

CREATE INDEX IF NOT EXISTS idx_media_jobs_tts_voice
    ON media_jobs (tts_voice_id);

-- Deterministic single-match backfill (origin V37 parity)
-- Only backfill when tts_voice_id matches an active tts_voices row whose provider
-- is active and has TTS capability.
WITH matched AS (
    SELECT mj.id AS job_id,
           COALESCE(tv.user_provider_id, tv.platform_provider_id) AS provider_id,
           tv.id AS voice_row_id
    FROM media_jobs mj
    JOIN tts_voices tv
        ON tv.id = mj.tts_voice_id
       AND tv.is_active = TRUE
    LEFT JOIN user_ai_providers up
        ON up.id = tv.user_provider_id
       AND up.is_active = TRUE
       AND 'TTS' = ANY(up.capabilities)
    LEFT JOIN platform_ai_providers pp
        ON pp.id = tv.platform_provider_id
       AND pp.is_active = TRUE
       AND 'TTS' = ANY(pp.capabilities)
    WHERE mj.tts_voice_id IS NOT NULL
      AND mj.tts_provider_id IS NULL
      AND (
          (tv.provider_source = 'USER' AND up.id IS NOT NULL) OR
          (tv.provider_source = 'PLATFORM' AND pp.id IS NOT NULL)
      )
),
single_match AS (
    SELECT job_id,
           MIN(provider_id::text)::uuid AS provider_id
    FROM matched
    GROUP BY job_id
    HAVING COUNT(DISTINCT provider_id) = 1
)
UPDATE media_jobs mj
SET tts_provider_id = sm.provider_id
FROM single_match sm
WHERE mj.id = sm.job_id
  AND mj.tts_provider_id IS NULL;

-- Enforce binding constraint: both must be present or both must be null
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'media_jobs' AND constraint_name = 'ck_media_jobs_tts_binding'
    ) THEN
        ALTER TABLE media_jobs
            ADD CONSTRAINT ck_media_jobs_tts_binding
            CHECK ((tts_provider_id IS NULL) = (tts_voice_id IS NULL));
    END IF;
END $$;
