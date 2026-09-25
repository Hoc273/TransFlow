ALTER TABLE media_job_stages
    ADD COLUMN error_code VARCHAR(100),
    ADD COLUMN error_detail JSONB;
