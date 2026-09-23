-- ============================================================================
-- V4 — Platform Super Admin audit log (SRS §5.8, System_Architecture §11.1)
-- Append-only access log for /api/platform/*. Platform domain only — no
-- workspace_id. users.is_platform_admin already exists in the V1 baseline.
-- ============================================================================

CREATE TABLE platform_admin_audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID         NULL REFERENCES users (id),
    action        VARCHAR(40)  NOT NULL,
    http_method   VARCHAR(10)  NOT NULL,
    path          VARCHAR(512) NOT NULL,
    query_string  VARCHAR(1024) NULL,
    ip            VARCHAR(64)  NULL,
    user_agent    VARCHAR(512) NULL,
    status_code   INT          NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_platform_audit_created
    ON platform_admin_audit_logs (created_at DESC);

CREATE INDEX ix_platform_audit_actor
    ON platform_admin_audit_logs (actor_user_id);

CREATE INDEX ix_platform_audit_action
    ON platform_admin_audit_logs (action);
