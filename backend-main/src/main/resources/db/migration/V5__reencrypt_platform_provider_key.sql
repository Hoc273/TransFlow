-- Re-encrypt platform seed API key sang PROVIDER_KEY_ENC_SECRET hiện hành (Option B).
-- Ciphertext uses AES-256-GCM (12-byte IV + ciphertext + 16-byte tag), generated
-- for the configured PROVIDER_KEY_ENC_SECRET. The key itself stays in runtime config.
-- Plaintext giữ nguyên placeholder 'platform-default-key' (chưa set key platform thật).
-- Replace the V2 seed payload, which was encrypted with an earlier development key.
UPDATE platform_ai_providers
SET api_key_enc = decode('ULMH8clSy2enHAf7Iz/h7k0hzfBkt1uOVLSTbn/CE+9V9aOHKnu6B9cg5bwIWWtd', 'base64')
WHERE id = '11111111-1111-1111-1111-111111111111';
