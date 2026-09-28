-- Phiên đăng nhập có trạng thái cho refresh token (rotation + thu hồi).
-- Mỗi lần đăng nhập (mật khẩu / Google) tạo 1 dòng. Refresh token = sid.generation.HMAC nên DB
-- không lưu token: chỉ giữ generation hiện tại. Mỗi lần refresh tăng generation; token của
-- generation trước còn nhận thêm 30 giây (nhiều tab refresh cùng lúc), quá thời gian đó mà vẫn
-- dùng lại token cũ => coi là bị đánh cắp và thu hồi cả phiên.
-- Hết hạn: không dùng quá app.jwt.refresh-ttl-days (14 ngày) hoặc quá expires_at (30 ngày từ lúc đăng nhập).
CREATE TABLE auth_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    generation      INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
    rotated_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  VARCHAR(32) CHECK (revoked_reason IN
                        ('LOGOUT','PASSWORD_CHANGED','PASSWORD_RESET','TOKEN_REUSE','ACCOUNT_DISABLED')),
    user_agent      VARCHAR(512),
    ip_address      VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Thu hồi hàng loạt theo user (đổi / lấy lại mật khẩu) chỉ quét phiên còn hiệu lực.
CREATE INDEX idx_auth_sessions_user_active ON auth_sessions (user_id) WHERE revoked_at IS NULL;
-- Job dọn phiên hết hạn / đã thu hồi.
CREATE INDEX idx_auth_sessions_expires_at ON auth_sessions (expires_at);
