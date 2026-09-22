-- V9: per-job Render Studio config (Database_Design.md §6.2, API_Contract.md §5 render-config)
-- IF NOT EXISTS: this was first shipped as V7 (renumbered after clashing with V7__add_is_platform_admin);
-- databases that already ran the old V7 keep working.
ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS render_config JSONB NOT NULL DEFAULT '{}';
