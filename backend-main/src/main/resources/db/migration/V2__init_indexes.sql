-- V2__init_indexes.sql
-- transflow_mini — toàn bộ index (UNIQUE + thường), tổng hợp từ docs/Database_Design.md (v3.3).
-- Chạy sau V1__init_tables.sql. Gom theo đúng nhóm bảng của V1 để dễ đối chiếu.

-- =========================================================================
-- Auth / Workspace / Project
-- =========================================================================

CREATE UNIQUE INDEX ux_users_email ON users (lower(email));
CREATE UNIQUE INDEX ux_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;

CREATE UNIQUE INDEX ux_workspaces_slug ON workspaces (slug);

CREATE UNIQUE INDEX ux_workspace_members_one_lead
    ON workspace_members(workspace_id) WHERE role = 'LEAD';
CREATE INDEX ix_workspace_members_user ON workspace_members(user_id);

CREATE INDEX ix_projects_workspace ON projects(workspace_id);

CREATE INDEX ix_project_members_user ON project_members(user_id);
CREATE INDEX ix_project_members_project ON project_members(project_id);

-- =========================================================================
-- Terms / Credit / AI providers
-- =========================================================================

CREATE UNIQUE INDEX ux_terms_versions_current ON terms_versions(is_current) WHERE is_current;

CREATE INDEX ix_credit_tx_user_time ON credit_transactions(user_id, created_at DESC);
CREATE INDEX ix_credit_tx_ref ON credit_transactions(ref_type, ref_id) WHERE ref_type IS NOT NULL;

CREATE INDEX ix_credit_pricing_active
    ON credit_pricing_config(capability, provider_scope) WHERE effective_to IS NULL;

CREATE INDEX ix_credit_package_purchases_user ON credit_package_purchases(user_id, purchased_at DESC);

CREATE INDEX ix_user_ai_providers_user ON user_ai_providers(user_id) WHERE is_active;

-- =========================================================================
-- Media core
-- =========================================================================

CREATE INDEX ix_media_assets_workspace_project ON media_assets(workspace_id, project_id);
CREATE INDEX ix_media_assets_parent ON media_assets(parent_asset_id);

CREATE INDEX ix_localization_batches_workspace ON localization_batches(workspace_id, status);

CREATE INDEX ix_media_jobs_workspace_status ON media_jobs(workspace_id, status);
CREATE INDEX ix_media_jobs_batch ON media_jobs(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX ix_media_jobs_project_created ON media_jobs(project_id, created_at DESC);
CREATE INDEX ix_media_jobs_source_summary ON media_jobs(source_summary_job_id) WHERE source_summary_job_id IS NOT NULL;
-- Phục vụ trực tiếp truy vấn "job của tôi" cho authorization QA/checkpoint (SRS §3.3).
CREATE INDEX ix_media_jobs_created_by ON media_jobs(created_by_user_id);

CREATE INDEX ix_media_job_stages_job ON media_job_stages(media_job_id, stage_name);

-- =========================================================================
-- Tóm tắt (Summarization)
-- =========================================================================

CREATE UNIQUE INDEX ux_proposal_round_ai
    ON summary_proposals(media_job_stage_id, generation_round) WHERE generated_by = 'AI';

CREATE INDEX ix_summary_proposal_segments_proposal ON summary_proposal_segments(proposal_id);

-- =========================================================================
-- Phụ đề & QA
-- =========================================================================

CREATE INDEX ix_subtitle_segments_job ON subtitle_segments(media_job_id);

CREATE INDEX ix_qa_issues_segment ON qa_issues(subtitle_segment_id) WHERE resolved_at IS NULL;

-- =========================================================================
-- Preset
-- =========================================================================

CREATE UNIQUE INDEX ux_preset_default_per_scope
    ON media_presets(scope, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'),
                      COALESCE(project_id, '00000000-0000-0000-0000-000000000000'))
    WHERE is_default;

-- =========================================================================
-- Notification & AI usage
-- =========================================================================

CREATE INDEX ix_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE INDEX ix_ai_usage_logs_workspace_op ON ai_usage_logs(workspace_id, operation, created_at DESC);
CREATE INDEX ix_ai_usage_logs_user ON ai_usage_logs(performed_by_user_id, created_at DESC);
