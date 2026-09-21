-- V10: Ensure render_config column exists on media_jobs table (safety migration across branch merges)
ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS render_config JSONB NOT NULL DEFAULT '{}';
