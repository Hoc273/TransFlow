package com.app.modules.media_job.dto;

import java.util.UUID;

/** {@code POST .../jobs/{jobId}/voice} body — null clears the voice (API_Contract.md §5). */
public record VoiceRequest(String ttsProviderId, UUID ttsVoiceId) {
    public VoiceRequest(UUID ttsVoiceId) {
        this(null, ttsVoiceId);
    }
}
