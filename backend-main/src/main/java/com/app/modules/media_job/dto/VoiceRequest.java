package com.app.modules.media_job.dto;

import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * Body for {@code POST .../jobs/{jobId}/voice} (ADR-CEP B7 parity).
 *
 * <p>When {@code ttsProviderId} + {@code ttsVoiceId} are both present, they form an explicit binding.
 * When only legacy {@code voiceId} (string) is supplied, the service resolves the active voice and
 * provider from the catalog.
 * Both/all null or blank clears the voice (keeps original audio).
 */
public record VoiceRequest(
        UUID ttsProviderId,
        UUID ttsVoiceId,
        @Size(max = 200) String voiceId
) {
    public VoiceRequest(UUID ttsProviderId, UUID ttsVoiceId) {
        this(ttsProviderId, ttsVoiceId, null);
    }

    public boolean isExplicitBinding() {
        return ttsProviderId != null && ttsVoiceId != null;
    }

    public boolean hasLegacyVoiceId() {
        return voiceId != null && !voiceId.isBlank();
    }

    public boolean isDeselect() {
        return ttsProviderId == null && ttsVoiceId == null
                && (voiceId == null || voiceId.isBlank());
    }
}
