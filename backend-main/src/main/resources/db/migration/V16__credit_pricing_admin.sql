-- ============================================================================
-- V16 — Super Admin quản trị bảng giá Credit (Credit_Coefficient_Calculation §10, C13)
-- Row giá không bao giờ bị sửa/xoá: mỗi lần đổi giá đóng row cũ tại effective_from
-- của row mới và insert row mới, nên chính bảng là lịch sử trước/sau đầy đủ.
-- ============================================================================

ALTER TABLE credit_pricing_config
    ADD COLUMN created_by_user_id UUID NULL REFERENCES users (id),
    ADD COLUMN change_reason      TEXT NULL;

-- provider_scope chuẩn hoá "protocol/model" chữ thường; '' coi như mặc định (NULL).
UPDATE credit_pricing_config
   SET provider_scope = NULLIF(lower(trim(provider_scope)), '')
 WHERE provider_scope IS NOT NULL;

-- Mỗi cặp capability + provider_scope chỉ có đúng 1 version đang mở (chống tạo trùng song song).
CREATE UNIQUE INDEX ux_credit_pricing_open
    ON credit_pricing_config (capability, COALESCE(provider_scope, ''))
    WHERE effective_to IS NULL;

-- Tra giá theo thời điểm tạo job và xem lịch sử.
CREATE INDEX ix_credit_pricing_history
    ON credit_pricing_config (capability, provider_scope, effective_from DESC);
