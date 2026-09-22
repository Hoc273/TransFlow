package com.app.modules.provider.dto;

/**
 * Response of {@code POST /api/tts-voices/preview}: a presigned GET URL (TTL
 * {@code app.storage.presigned-ttl-seconds}) pointing at the synthesized mp3 preview.
 */
public record TtsVoicePreviewResponse(
        String audioUrl
) {}
