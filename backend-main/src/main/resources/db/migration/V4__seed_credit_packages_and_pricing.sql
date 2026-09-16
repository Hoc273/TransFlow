-- V4__seed_credit_packages_and_pricing.sql
-- Seed standard credit packages and baseline pricing coefficients for TransFlow Media.

-- 1. Credit packages
INSERT INTO credit_packages (id, name, credit_amount, price_amount, price_currency, is_active, created_at)
VALUES 
    (gen_random_uuid(), 'Gói Khởi động (Starter)', 500.0000, 50000.00, 'VND', true, now()),
    (gen_random_uuid(), 'Gói Sáng tạo (Creator)', 2000.0000, 180000.00, 'VND', true, now()),
    (gen_random_uuid(), 'Gói Chuyên nghiệp (Business)', 10000.0000, 800000.00, 'VND', true, now());

-- 2. Baseline pricing configuration for capabilities (x = infra, y = token)
INSERT INTO credit_pricing_config (id, capability, provider_scope, infra_coefficient_x, token_coefficient_y, effective_from, effective_to, created_at)
VALUES
    (gen_random_uuid(), 'STT', NULL, 0.000100, 0.000300, now(), NULL, now()),
    (gen_random_uuid(), 'TRANSLATE', NULL, 0.000100, 0.000400, now(), NULL, now()),
    (gen_random_uuid(), 'TTS', NULL, 0.000150, 0.000500, now(), NULL, now()),
    (gen_random_uuid(), 'SUMMARIZE_SCRIPT', NULL, 0.000100, 0.000400, now(), NULL, now()),
    (gen_random_uuid(), 'RENDER', NULL, 0.000200, 0.000000, now(), NULL, now()),
    (gen_random_uuid(), 'VISION', NULL, 0.000200, 0.000600, now(), NULL, now());
