-- V7: per-job Render Studio config (Database_Design.md §6.2, API_Contract.md §5 render-config)
ALTER TABLE media_jobs ADD COLUMN render_config JSONB NOT NULL DEFAULT '{}';
