package com.app.modules.media_job.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Create Media Job body (API_Contract.md §5). Deliberately NOT copied from the legacy
 * {@code CreateMediaJobRequest} in {@code transflow} — no {@code documentId}/CT-recipe fields
 * (Backend_Java_TaskSplit_MemberB.md §2.2 warning).
 */
public record CreateMediaJobRequest(
        @NotNull UUID projectId,
        @NotNull UUID rootAssetId,
        @NotBlank String recipeId,
        String processingMode,
        String sourceLang,
        @NotBlank String targetLang,
        Integer requestedDurationSeconds,
        String subtitleMode,
        String outputAudioMode,
        Boolean sourceSeparationEnabled,
        UUID ttsProviderId,
        UUID ttsVoiceId,
        Boolean visualContextEnabled,
        String workflowMode,
        UUID presetId,
        String requestedMode,
        Boolean keepOriginalAudio
) {
    public CreateMediaJobRequest(
            UUID projectId, UUID rootAssetId, String recipeId, String processingMode,
            String targetLang, Integer requestedDurationSeconds, String subtitleMode,
            String outputAudioMode, Boolean sourceSeparationEnabled, UUID ttsVoiceId,
            Boolean visualContextEnabled, String workflowMode, UUID presetId
    ) {
        this(projectId, rootAssetId, recipeId, processingMode, null, targetLang,
                requestedDurationSeconds, subtitleMode, outputAudioMode, sourceSeparationEnabled,
                null, ttsVoiceId, visualContextEnabled, workflowMode, presetId, null, null);
    }

    public CreateMediaJobRequest(
            UUID projectId, UUID rootAssetId, String recipeId, String processingMode,
            String targetLang, Integer requestedDurationSeconds, String subtitleMode,
            String outputAudioMode, Boolean sourceSeparationEnabled, UUID ttsProviderId,
            UUID ttsVoiceId, Boolean visualContextEnabled, String workflowMode, UUID presetId
    ) {
        this(projectId, rootAssetId, recipeId, processingMode, null, targetLang,
                requestedDurationSeconds, subtitleMode, outputAudioMode, sourceSeparationEnabled,
                ttsProviderId, ttsVoiceId, visualContextEnabled, workflowMode, presetId, null, null);
    }
}
