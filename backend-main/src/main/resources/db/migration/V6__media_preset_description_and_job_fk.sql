-- Preset admin: mô tả hiển thị trên trang Preset (tùy chọn).
ALTER TABLE media_presets ADD COLUMN IF NOT EXISTS description VARCHAR(1000);

-- Job đã đóng băng cấu hình preset trong media_jobs.preset_snapshot, nên xoá preset không được chặn
-- bởi các job cũ: FK chuyển sang ON DELETE SET NULL.
ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS media_jobs_preset_id_fkey;
ALTER TABLE media_jobs
    ADD CONSTRAINT media_jobs_preset_id_fkey
        FOREIGN KEY (preset_id) REFERENCES media_presets(id) ON DELETE SET NULL;
