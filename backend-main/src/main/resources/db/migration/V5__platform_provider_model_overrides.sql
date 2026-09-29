-- Model riêng theo thao tác cho 1 key platform TRANSLATE (Tóm tắt / Refine / QA chạy trên key TRANSLATE).
-- Ví dụ FreeLLMAPI: default_model = 'auto:translate',
--   model_overrides = {"SUMMARIZE_SCRIPT": "auto:script", "REFINE": "auto:script", "QA": "auto:script"}.
-- Thao tác không có trong map dùng default_model. Key BYOK không có cột này.
ALTER TABLE platform_ai_providers
    ADD COLUMN model_overrides JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(model_overrides) = 'object');
