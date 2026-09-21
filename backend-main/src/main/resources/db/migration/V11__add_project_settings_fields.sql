-- Add default_glossary_id, tm_enabled, domain, tone to projects table if missing
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS default_glossary_id UUID,
    ADD COLUMN IF NOT EXISTS tm_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS domain VARCHAR(80),
    ADD COLUMN IF NOT EXISTS tone VARCHAR(80);
