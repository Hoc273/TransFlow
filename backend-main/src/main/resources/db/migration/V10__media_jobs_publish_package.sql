-- V10: publish metadata draft of a job (Database_Design.md §6.2, API_Contract.md §5 publish-package)
-- NULL = nothing saved yet.
ALTER TABLE media_jobs ADD COLUMN IF NOT EXISTS publish_package JSONB;
