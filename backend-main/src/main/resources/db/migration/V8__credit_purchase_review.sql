-- Mua gói credit chưa có cổng thanh toán: trước đây endpoint purchase cộng credit ngay với bất kỳ
-- paymentReference nào người dùng nhập. Từ nay mỗi lần mua là một yêu cầu PENDING, chỉ cộng credit
-- khi Super Admin đối soát chuyển khoản và duyệt (API_Contract §10, §13.1).
ALTER TABLE credit_package_purchases
    ADD COLUMN status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    ADD COLUMN reviewed_by UUID REFERENCES users(id),
    ADD COLUMN reviewed_at TIMESTAMPTZ,
    ADD COLUMN review_note VARCHAR(255);

-- Các bản ghi cũ đã được cộng credit mà không hề xác minh: giữ nguyên để đối soát, gắn nhãn riêng.
UPDATE credit_package_purchases SET status = 'LEGACY_UNVERIFIED';

ALTER TABLE credit_package_purchases
    ADD CONSTRAINT ck_credit_package_purchases_status
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'LEGACY_UNVERIFIED'));

-- Một mã chuyển khoản chỉ dùng được cho một yêu cầu còn hiệu lực (không phân biệt hoa/thường).
CREATE UNIQUE INDEX ux_credit_package_purchases_reference_active
    ON credit_package_purchases (UPPER(payment_reference))
    WHERE status IN ('PENDING', 'APPROVED');

CREATE INDEX ix_credit_package_purchases_status
    ON credit_package_purchases (status, purchased_at DESC);
