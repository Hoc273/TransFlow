CREATE TABLE user_ai_provider_defaults (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    capability VARCHAR(20) NOT NULL CHECK (capability IN ('STT', 'TRANSLATE', 'TTS', 'VISION')),
    provider_id UUID NOT NULL REFERENCES user_ai_providers(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, capability)
);
