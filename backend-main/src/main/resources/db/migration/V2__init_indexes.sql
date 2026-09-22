-- V2__init_indexes.sql
-- Indexes and bootstrap data for the squashed TransFlow baseline.
-- Run only after V1__init_tables.sql on a fresh schema.

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
CREATE INDEX ix_media_jobs_tts_provider ON media_jobs(tts_provider_id);
CREATE INDEX ix_media_jobs_tts_voice ON media_jobs(tts_voice_id);

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

-- =========================================================================
-- Bootstrap data (formerly V3-V6)
-- =========================================================================

INSERT INTO terms_versions (version, content_ref, is_current, published_at)
VALUES ('v1', 'terms/v1.md', true, now());

INSERT INTO credit_packages (id, name, credit_amount, price_amount, price_currency, is_active, created_at)
VALUES
    (gen_random_uuid(), 'Gói Khởi động (Starter)', 500.0000, 50000.00, 'VND', true, now()),
    (gen_random_uuid(), 'Gói Sáng tạo (Creator)', 2000.0000, 180000.00, 'VND', true, now()),
    (gen_random_uuid(), 'Gói Chuyên nghiệp (Business)', 10000.0000, 800000.00, 'VND', true, now());

INSERT INTO credit_pricing_config (
    id, capability, provider_scope, infra_coefficient_x, token_coefficient_y,
    effective_from, effective_to, created_at
) VALUES
    (gen_random_uuid(), 'STT', NULL, 0.000100, 0.000300, now(), NULL, now()),
    (gen_random_uuid(), 'TRANSLATE', NULL, 0.000100, 0.000400, now(), NULL, now()),
    (gen_random_uuid(), 'TTS', NULL, 0.000150, 0.000500, now(), NULL, now()),
    (gen_random_uuid(), 'SUMMARIZE_SCRIPT', NULL, 0.000100, 0.000400, now(), NULL, now()),
    (gen_random_uuid(), 'RENDER', NULL, 0.000200, 0.000000, now(), NULL, now()),
    (gen_random_uuid(), 'VISION', NULL, 0.000200, 0.000600, now(), NULL, now());

INSERT INTO platform_ai_providers (
    id, protocol, capabilities, base_url, api_key_enc, default_model, is_active, created_at
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'openai_compatible',
    ARRAY['STT','TRANSLATE','TTS','VISION']::VARCHAR[],
    'https://api.openai.com/v1',
    decode('tnctYyrQvJqa4i08mbPH5G+RZIf4MfSfGsvqetgzOtqLRDTCz/YBi9UGLIuIzl75', 'base64'),
    'gpt-4o',
    true,
    now()
);

INSERT INTO tts_voices (
    id, provider_source, platform_provider_id, voice_id, language, languages, gender, is_active, cached_at
) VALUES
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'alloy', 'en', ARRAY['en','vi']::VARCHAR[], 'UNKNOWN', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'echo', 'en', ARRAY['en','vi']::VARCHAR[], 'MALE', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'fable', 'en', ARRAY['en','vi']::VARCHAR[], 'UNKNOWN', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'onyx', 'en', ARRAY['en','vi']::VARCHAR[], 'MALE', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'nova', 'en', ARRAY['en','vi']::VARCHAR[], 'FEMALE', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'shimmer', 'en', ARRAY['en','vi']::VARCHAR[], 'FEMALE', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'nova-vi', 'vi', ARRAY['vi','en']::VARCHAR[], 'FEMALE', true, now()),
    (gen_random_uuid(), 'PLATFORM', '11111111-1111-1111-1111-111111111111', 'onyx-vi', 'vi', ARRAY['vi','en']::VARCHAR[], 'MALE', true, now());

INSERT INTO media_presets (
    id, scope, workspace_id, project_id, name, subtitle_style, voice_config,
    render_config, is_default, active
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'SYSTEM', NULL, NULL, 'Standard Subtitle & Dub',
    '{"fontFamily":"Inter","fontSize":24,"textColor":"#FFFFFF","backgroundColor":"#00000080","subtitlePosition":"BOTTOM","verticalOffsetPercent":8}'::jsonb,
    '{"stability":0.75,"similarityBoost":0.85,"style":0.0}'::jsonb,
    '{"outputAspectRatio":"16:9","videoCodec":"libx264","audioCodec":"aac"}'::jsonb,
    true, true
), (
    '00000000-0000-0000-0000-000000000002',
    'SYSTEM', NULL, NULL, 'Social Media Shorts / Reels',
    '{"fontFamily":"Roboto","fontSize":32,"textColor":"#FFD700","backgroundColor":"#000000CC","subtitlePosition":"CENTER","verticalOffsetPercent":0,"isBold":true}'::jsonb,
    '{"stability":0.70,"similarityBoost":0.80,"style":0.2}'::jsonb,
    '{"outputAspectRatio":"9:16","videoCodec":"libx264","audioCodec":"aac"}'::jsonb,
    false, true
), (
    '00000000-0000-0000-0000-000000000003',
    'SYSTEM', NULL, NULL, 'Cinematic Subtitles',
    '{"fontFamily":"Outfit","fontSize":22,"textColor":"#F0F0F0","backgroundColor":"#1A1A1AB3","subtitlePosition":"BOTTOM","verticalOffsetPercent":5}'::jsonb,
    '{}'::jsonb,
    '{"outputAspectRatio":"21:9","videoCodec":"libx264","audioCodec":"aac"}'::jsonb,
    false, true
);
