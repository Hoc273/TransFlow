-- Nhật ký hoạt động của người dùng thường (ngoài /api/platform/** đã có platform_admin_audit_logs).
-- Ghi mọi request thay đổi dữ liệu (POST/PUT/PATCH/DELETE) đã xác thực và các lần đăng nhập thất bại.
-- Đăng nhập thành công đã có trong auth_sessions. Dọn sau app.activity-log.retention-days (mặc định 90).
CREATE TABLE user_activity_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID          NULL REFERENCES users (id) ON DELETE SET NULL,
    workspace_id UUID          NULL,
    action       VARCHAR(160)  NOT NULL,
    http_method  VARCHAR(10)   NOT NULL,
    path         VARCHAR(512)  NOT NULL,
    ip           VARCHAR(64)   NULL,
    user_agent   VARCHAR(512)  NULL,
    status_code  INT           NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ix_user_activity_created ON user_activity_logs (created_at DESC);
CREATE INDEX ix_user_activity_user ON user_activity_logs (user_id, created_at DESC);
CREATE INDEX ix_user_activity_workspace ON user_activity_logs (workspace_id, created_at DESC);
