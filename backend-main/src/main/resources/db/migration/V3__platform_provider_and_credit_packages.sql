-- Provider seed ở V2 chỉ mang key placeholder ('platform-default-key') được mã hóa bằng
-- PROVIDER_KEY_ENC_SECRET của môi trường dev: ở môi trường khác secret không khớp nên giải mã lỗi
-- (PROVIDER_KEY_DECRYPTION_FAILED), và kể cả giải mã được thì key cũng không gọi được provider thật.
-- Tắt nó khỏi pool cho tới khi Super Admin nhập key thật; chỉ đụng tới bản ghi còn giữ nguyên
-- ciphertext placeholder, key đã được cấu hình lại thì giữ nguyên trạng thái.
UPDATE platform_ai_providers
SET is_active = false
WHERE id = '11111111-1111-1111-1111-111111111111'
  AND api_key_enc = decode('ULMH8clSy2enHAf7Iz/h7k0hzfBkt1uOVLSTbn/CE+9V9aOHKnu6B9cg5bwIWWtd', 'base64');

-- Gói Credit v3 (Credit_Coefficient_Calculation §9, chốt 2026-09-28): giữ 1 Credit = 100đ, nâng giá
-- nạp tối thiểu lên 250.000đ. Mức tiêu hao Credit/phút tăng ×2 qua version giá mới do Super Admin
-- tạo ở /api/platform/pricing, không nằm trong migration này.
-- Không sửa/xoá gói cũ: credit_package_purchases.package_id vẫn tham chiếu tới chúng để đối soát,
-- chỉ tắt để /api/credit/packages không còn trả về.
UPDATE credit_packages
SET is_active = false
WHERE is_active = true;

INSERT INTO credit_packages (id, name, credit_amount, price_amount, price_currency, is_active, created_at)
VALUES
    (gen_random_uuid(), 'Gói Khởi động (Starter)', 2500.0000, 250000.00, 'VND', true, now()),
    (gen_random_uuid(), 'Gói Sáng tạo (Creator)', 5250.0000, 500000.00, 'VND', true, now()),
    (gen_random_uuid(), 'Gói Chuyên nghiệp (Business)', 10000.0000, 900000.00, 'VND', true, now());

-- Đóng 8 row giá "mẫu" theo model (Credit_Coefficient_Calculation §7.6): không provider nền tảng nào
-- dùng đúng các model này làm default_model, và khi thiếu row thì resolver rơi xuống row protocol
-- 'openai_compatible' (cùng giá) hoặc row NULL (đắt hơn) — không bao giờ bán rẻ hơn giá thật.
-- Giữ các row gpt-4o / tts-1-hd: thiếu chúng thì model đắt sẽ bị tính theo giá protocol (rẻ ~17 lần).
-- Chỉ đóng (effective_to), không xoá: bảng giá là lịch sử đối soát. GREATEST để không tạo khoảng
-- hiệu lực âm với version đang hẹn giờ.
UPDATE credit_pricing_config
SET effective_to = GREATEST(now(), effective_from)
WHERE effective_to IS NULL
  AND (capability, provider_scope) IN (
      ('STT',              'openai_compatible/whisper-1'),
      ('STT',              'openai_compatible/gpt-4o-mini-transcribe'),
      ('TRANSLATE',        'openai_compatible/gpt-4o-mini'),
      ('TRANSLATE',        'dashscope_native/qwen-plus'),
      ('SUMMARIZE_SCRIPT', 'openai_compatible/gpt-4o-mini'),
      ('SUMMARIZE_SCRIPT', 'dashscope_native/qwen-plus'),
      ('TTS',              'openai_compatible/tts-1'),
      ('VISION',           'openai_compatible/gpt-4o-mini')
  );
