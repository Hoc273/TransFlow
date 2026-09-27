-- V2__init_indexes.sql
-- Indexes and bootstrap data for the squashed TransFlow baseline (former V1-V17).
-- Run only after V1__init_tables.sql on a fresh schema.

-- =========================================================================
-- Auth / Workspace / Project
-- =========================================================================

CREATE UNIQUE INDEX ux_users_email ON users (lower(email));
CREATE UNIQUE INDEX ux_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX idx_users_email_canonical ON users (email_canonical);

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
-- Mỗi cặp capability + provider_scope chỉ có đúng 1 version đang mở (chống tạo trùng song song).
CREATE UNIQUE INDEX ux_credit_pricing_open
    ON credit_pricing_config (capability, COALESCE(provider_scope, ''))
    WHERE effective_to IS NULL;
-- Tra giá theo thời điểm tạo job và xem lịch sử.
CREATE INDEX ix_credit_pricing_history
    ON credit_pricing_config (capability, provider_scope, effective_from DESC);

CREATE INDEX ix_credit_package_purchases_user ON credit_package_purchases(user_id, purchased_at DESC);

CREATE INDEX ix_user_ai_providers_user ON user_ai_providers(user_id) WHERE is_active;

CREATE INDEX ix_platform_ai_providers_pool ON platform_ai_providers (is_active, priority);

-- =========================================================================
-- Media core
-- =========================================================================

CREATE INDEX ix_media_assets_workspace_project ON media_assets(workspace_id, project_id);
CREATE INDEX ix_media_assets_parent ON media_assets(parent_asset_id);
CREATE INDEX ix_media_assets_retention ON media_assets (created_at) WHERE purged_at IS NULL;

CREATE INDEX ix_localization_batches_workspace ON localization_batches(workspace_id, status);

CREATE INDEX ix_media_jobs_workspace_status ON media_jobs(workspace_id, status);
CREATE INDEX ix_media_jobs_batch ON media_jobs(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX ix_media_jobs_project_created ON media_jobs(project_id, created_at DESC);
CREATE INDEX ix_media_jobs_source_summary ON media_jobs(source_summary_job_id) WHERE source_summary_job_id IS NOT NULL;
-- Phục vụ trực tiếp truy vấn "job của tôi" cho authorization QA/checkpoint (SRS §3.3).
CREATE INDEX ix_media_jobs_created_by ON media_jobs(created_by_user_id);
CREATE INDEX ix_media_jobs_tts_provider ON media_jobs(tts_provider_id);
CREATE INDEX ix_media_jobs_tts_voice ON media_jobs(tts_voice_id);
-- Reconciler: job chưa kết thúc theo lần cập nhật cuối.
CREATE INDEX ix_media_jobs_status_updated ON media_jobs (status, updated_at);

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
CREATE INDEX ix_notifications_created ON notifications (created_at);

CREATE INDEX ix_ai_usage_logs_workspace_op ON ai_usage_logs(workspace_id, operation, created_at DESC);
CREATE INDEX ix_ai_usage_logs_user ON ai_usage_logs(performed_by_user_id, created_at DESC);
CREATE INDEX ix_ai_usage_logs_provider ON ai_usage_logs (provider_id, created_at);

-- =========================================================================
-- Platform admin audit log & Guide
-- =========================================================================

CREATE INDEX ix_platform_audit_created ON platform_admin_audit_logs (created_at DESC);
CREATE INDEX ix_platform_audit_actor ON platform_admin_audit_logs (actor_user_id);
CREATE INDEX ix_platform_audit_action ON platform_admin_audit_logs (action);

CREATE INDEX ix_guide_categories_order ON guide_categories (order_index);
CREATE INDEX ix_guide_categories_published ON guide_categories (is_published);
CREATE INDEX ix_guide_articles_category_order ON guide_articles (category_id, order_index);
CREATE INDEX ix_guide_articles_status ON guide_articles (status);

-- =========================================================================
-- Bootstrap data
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

-- api_key_enc: AES-256-GCM (IV 12 byte + ciphertext + tag 16 byte) của placeholder 'platform-default-key'
-- theo PROVIDER_KEY_ENC_SECRET hiện hành; key thật do Super Admin cấu hình qua /api/platform.
INSERT INTO platform_ai_providers (
    id, protocol, capabilities, base_url, api_key_enc, default_model, is_active, created_at, name
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'openai_compatible',
    ARRAY['STT','TRANSLATE','TTS','VISION']::VARCHAR[],
    'https://api.openai.com/v1',
    decode('ULMH8clSy2enHAf7Iz/h7k0hzfBkt1uOVLSTbn/CE+9V9aOHKnu6B9cg5bwIWWtd', 'base64'),
    'gpt-4o',
    true,
    now(),
    'openai_compatible (STT,TRANSLATE,TTS,VISION)'
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

-- System preset render-ready (Database_Design.md §9): không có SYSTEM default (job không preset giữ
-- SOFT_SUB + khung gốc); render_config dùng key của media_jobs.render_config, subtitle_style là
-- SubtitleStyleSnapshot đầy đủ. Chữ đen trên nền vàng nhạt, viền trắng mảnh (4, tính cho khung 1080 dòng),
-- gom cue thành cụm 5 từ. Shorts/Reels đặt cao hơn (-13 => 75%) để tránh UI đáy Reels/TikTok.
INSERT INTO media_presets (
    id, scope, workspace_id, project_id, name, subtitle_style, voice_config,
    render_config, is_default, active
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'SYSTEM', NULL, NULL, 'Standard Subtitle & Dub',
    '{"font_family":"Arial","font_size":44,"primary_color":"#000000","outline_color":"#FFFFFF","outline_width":4,"shadow":false,"bold":false,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#FFF59DE6","opacity":100}'::jsonb,
    '{}'::jsonb,
    '{"subtitleMode":"HARD_SUB","subtitlePosition":"BOTTOM","verticalOffsetPercent":-8,"backgroundBox":true,"backgroundColor":"#FFF59DE6","textColor":"#000000","outputAspectRatio":"16:9","presentation":{"subtitle":{"displayMode":"PHRASE","wordsPerPhrase":5}}}'::jsonb,
    false, true
), (
    '00000000-0000-0000-0000-000000000002',
    'SYSTEM', NULL, NULL, 'Social Media Shorts / Reels',
    '{"font_family":"Arial","font_size":40,"primary_color":"#000000","outline_color":"#FFFFFF","outline_width":4,"shadow":false,"bold":true,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#FFF59DE6","opacity":100}'::jsonb,
    '{}'::jsonb,
    '{"subtitleMode":"HARD_SUB","subtitlePosition":"BOTTOM","verticalOffsetPercent":-13,"backgroundBox":true,"backgroundColor":"#FFF59DE6","textColor":"#000000","outputAspectRatio":"9:16","presentation":{"subtitle":{"displayMode":"PHRASE","wordsPerPhrase":5}}}'::jsonb,
    false, true
);

-- Guide: danh mục + bài viết mẫu đã xuất bản.
INSERT INTO guide_categories (id, slug, title_vi, title_en, order_index, is_published, created_at, updated_at)
VALUES
    ('11111111-1111-1111-1111-111111111101', 'bat-dau', 'Bắt đầu', 'Getting Started', 0, true, now(), now()),
    ('11111111-1111-1111-1111-111111111102', 'dich-va-long-tieng', 'Dịch & Lồng tiếng', 'Translation & Dubbing', 1, true, now(), now()),
    ('11111111-1111-1111-1111-111111111103', 'xu-ly-hang-loat', 'Xử lý hàng loạt', 'Batch Processing', 2, true, now(), now());

INSERT INTO guide_articles (id, category_id, slug, title_vi, title_en, excerpt_vi, excerpt_en, content_vi, content_en, status, order_index, created_at, updated_at)
VALUES
    (
        '22222222-2222-2222-2222-222222222201',
        '11111111-1111-1111-1111-111111111101',
        'tong-quan-transflow',
        'Tổng quan về TransFlow',
        'Overview of TransFlow',
        'Làm quen với nền tảng biên dịch và lồng tiếng video đa ngữ TransFlow.',
        'Get familiar with TransFlow, the multilingual video translation and dubbing platform.',
        '# Tổng quan về TransFlow

Chào mừng bạn đến với **TransFlow** — nền tảng AI hỗ trợ biên dịch, tạo phụ đề và lồng tiếng video chuyên nghiệp.

## Các tính năng chính
- **Nhận diện giọng nói (ASR):** Tự động chuyển đổi âm thanh trong video thành phụ đề chuẩn xác.
- **Biên dịch ngữ cảnh (MT):** Dịch phụ đề sang nhiều ngôn ngữ đích với thuật ngữ ngành chính xác.
- **Lồng tiếng AI (TTS):** Tái tạo giọng đọc tự nhiên, đồng bộ khẩu hình và nhịp điệu với bản gốc.
- **Biên tập thời gian thực:** Trình chỉnh sửa chuyên dụng cho phép duyệt từng câu thoại và điều chỉnh âm lượng.

## Bước tiếp theo
Hãy xem bài viết **Tạo dự án video đầu tiên** để bắt đầu quy trình biên dịch của bạn.',
        '# Overview of TransFlow

Welcome to **TransFlow** — the AI-powered platform for video translation, subtitling, and professional dubbing.

## Key Features
- **Speech Recognition (ASR):** Automatically transcribe video audio into accurate subtitles.
- **Contextual Translation (MT):** Translate subtitles into multiple target languages with industry-specific terminology.
- **AI Dubbing (TTS):** Generate natural speech voices synchronized with original speech pacing.
- **Real-time Studio Editor:** Dedicated interactive editor to review subtitles, segments, and audio levels.

## Next Steps
Check out the **Creating your first video project** guide to begin your translation workflow.',
        'PUBLISHED',
        0,
        now(),
        now()
    ),
    (
        '22222222-2222-2222-2222-222222222202',
        '11111111-1111-1111-1111-111111111101',
        'tao-du-an-dau-tien',
        'Tạo dự án video đầu tiên',
        'Creating your first video project',
        'Hướng dẫn từng bước tải lên video, chọn cấu hình ngôn ngữ và khởi chạy pipeline.',
        'Step-by-step guide to uploading videos, selecting language settings, and running the pipeline.',
        '# Tạo dự án video đầu tiên

Chỉ mất vài phút để thiết lập và chạy một dự án biên dịch video hoàn chỉnh.

## 1. Tải lên video nguồn
1. Truy cập vào **Workspace** của bạn.
2. Nhấn nút **Tải lên Media** hoặc kéo thả file video (hỗ trợ MP4, MOV, MKV).
3. Hệ thống sẽ trích xuất audio và kiểm tra thời lượng.

## 2. Thiết lập thông số dịch
- Chọn ngôn ngữ nguồn (Source Language).
- Chọn ngôn ngữ đích (Target Language).
- Chọn Preset dịch phù hợp (ví dụ: Marketing, Giáo dục, Tin tức).

## 3. Khởi chạy và theo dõi
Nhấn **Bắt đầu xử lý**. Bạn có thể theo dõi tiến độ từng công đoạn trên màn hình trực quan.',
        '# Creating your first video project

Set up and execute a complete video translation project in just a few minutes.

## 1. Upload Source Video
1. Navigate to your **Workspace**.
2. Click **Upload Media** or drag and drop your video file (supports MP4, MOV, MKV).
3. The platform extracts audio tracks and validates duration.

## 2. Configure Translation Settings
- Select source language.
- Select target language.
- Choose a translation preset (e.g., Marketing, Education, News).

## 3. Launch and Monitor
Click **Start Processing**. You can monitor real-time pipeline stages directly from the dashboard.',
        'PUBLISHED',
        1,
        now(),
        now()
    ),
    (
        '22222222-2222-2222-2222-222222222203',
        '11111111-1111-1111-1111-111111111102',
        'quy-trinh-dich-va-long-tieng',
        'Quy trình dịch và lồng tiếng tự động',
        'Automated Translation & Dubbing Workflow',
        'Tìm hiểu sâu về cách hoạt động của pipeline ASR, Translation và TTS trong TransFlow.',
        'Deep dive into the inner workings of ASR, Translation, and TTS pipelines in TransFlow.',
        '# Quy trình dịch và lồng tiếng tự động

Pipeline xử lý của TransFlow được xây dựng trên kiến trúc pipeline bất đồng bộ tối ưu hóa độ trễ.

## Các giai đoạn xử lý
1. **Diarization & ASR:** Tách người nói và sinh timestamps chính xác từng từ.
2. **Translation & QA:** Tối ưu độ dài câu dịch để vừa khớp với khoảng thời gian nói ban đầu.
3. **Voice Cloning & TTS:** Áp dụng chất giọng phù hợp với ngữ cảnh nhân vật.
4. **Audio Mixing:** Cân bằng âm nền (BGM) và giọng lồng tiếng mới, đảm bảo trải nghiệm âm thanh chân thực.',
        '# Automated Translation & Dubbing Workflow

TransFlow processing pipeline is built on an asynchronous, latency-optimized architecture.

## Processing Stages
1. **Diarization & ASR:** Speaker identification and word-level timestamp generation.
2. **Translation & QA:** Length-adjusted translation matching original speaking intervals.
3. **Voice Cloning & TTS:** Voice casting matching tone and character context.
4. **Audio Mixing:** Seamless ducking of background music with new dubbed voices.',
        'PUBLISHED',
        0,
        now(),
        now()
    );
