-- ============================================================================
-- V5 — Trang Hướng Dẫn (Guide Module)
-- Category and Article tables with multi-language (vi/en) support & sample seeds.
-- ============================================================================

CREATE TABLE guide_categories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          VARCHAR(120) NOT NULL UNIQUE,
    title_vi      VARCHAR(200) NOT NULL,
    title_en      VARCHAR(200) NOT NULL,
    order_index   INT          NOT NULL DEFAULT 0,
    is_published  BOOLEAN      NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX ix_guide_categories_order ON guide_categories (order_index);
CREATE INDEX ix_guide_categories_published ON guide_categories (is_published);

CREATE TABLE guide_articles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id     UUID          NOT NULL REFERENCES guide_categories (id) ON DELETE RESTRICT,
    slug            VARCHAR(160)  NOT NULL UNIQUE,
    title_vi        VARCHAR(300)  NOT NULL,
    title_en        VARCHAR(300)  NOT NULL,
    excerpt_vi      VARCHAR(500)  NULL,
    excerpt_en      VARCHAR(500)  NULL,
    content_vi      TEXT          NOT NULL,
    content_en      TEXT          NOT NULL,
    status          VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
    order_index     INT           NOT NULL DEFAULT 0,
    cover_image_url VARCHAR(1000) NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX ix_guide_articles_category_order ON guide_articles (category_id, order_index);
CREATE INDEX ix_guide_articles_status ON guide_articles (status);

-- Seed Categories & Sample Published Articles
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
