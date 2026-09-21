-- V8: subtitle style snapshot assigned to a job (Database_Design.md §6.2, API_Contract.md §5 subtitle-style)
-- NULL = no style assigned yet.
ALTER TABLE media_jobs ADD COLUMN subtitle_style JSONB;
