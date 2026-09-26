-- ============================================================================
-- V17 — Chặn tạo nhiều tài khoản từ 1 hộp thư bằng alias (user+1@gmail.com,
-- u.s.e.r@gmail.com, ...@googlemail.com) để farm credit khởi tạo.
-- email_canonical do backend-main tính (EmailNormalizer); backfill dưới đây phải
-- giữ đúng cùng quy tắc: bỏ phần "+tag"; riêng Gmail bỏ dấu chấm và gộp domain.
-- Index KHÔNG unique: dữ liệu cũ có thể đã trùng canonical — service kiểm tra
-- trùng khi đăng ký mới.
-- ============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_canonical VARCHAR(320);

UPDATE users
SET email_canonical = CASE
        WHEN split_part(lower(trim(email)), '@', 2) IN ('gmail.com', 'googlemail.com')
            THEN replace(split_part(split_part(lower(trim(email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
        ELSE split_part(split_part(lower(trim(email)), '@', 1), '+', 1) || '@' || split_part(lower(trim(email)), '@', 2)
    END
WHERE email_canonical IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_canonical ON users (email_canonical);
