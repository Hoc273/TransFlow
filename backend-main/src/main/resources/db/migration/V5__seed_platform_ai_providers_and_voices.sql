-- V5__seed_platform_ai_providers_and_voices.sql
-- transflow_mini — Nguồn AI nền tảng và danh mục giọng đọc chuẩn (Database_Design.md §5, API_Contract.md §11).

-- 1. Nền tảng AI Provider mặc định (hỗ trợ STT, TRANSLATE, TTS, VISION)
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

-- 2. Danh mục giọng đọc nền tảng mặc định (phục vụ UI chọn giọng khi user không có BYOK)
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
