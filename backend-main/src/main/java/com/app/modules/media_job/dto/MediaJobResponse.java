package com.app.modules.media_job.dto;

import com.app.modules.media_job.entity.MediaJob;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record MediaJobResponse(
        UUID id,
        UUID workspaceId,
        UUID projectId,
        UUID rootAssetId,
        UUID batchId,
        String recipeId,
        String processingMode,
        String sourceLanguage,
        String targetLang,
        String status,
        Integer requestedDurationSeconds,
        UUID selectedProposalId,
        UUID sourceSummaryJobId,
        String subtitleMode,
        String outputAudioMode,
        boolean sourceSeparationEnabled,
        UUID ttsVoiceId,
        boolean visualContextEnabled,
        UUID presetId,
        String workflowMode,
        UUID performedByUserId,
        UUID createdByUserId,
        Instant createdAt,
        Instant updatedAt,
        List<MediaJobStageResponse> stages
) {
    public static MediaJobResponse from(MediaJob j) {
        return from(j, null);
    }

    public static MediaJobResponse from(MediaJob j, List<MediaJobStageResponse> stages) {
        return new MediaJobResponse(
                j.getId(), j.getWorkspaceId(), j.getProjectId(), j.getRootAssetId(), j.getBatchId(),
                j.getRecipeId(), j.getProcessingMode() != null ? j.getProcessingMode().name() : null,
                j.getSourceLanguage(), j.getTargetLang(), j.getStatus().name(), j.getRequestedDurationSeconds(),
                j.getSelectedProposalId(), j.getSourceSummaryJobId(), j.getSubtitleMode().name(),
                j.getOutputAudioMode().name(), j.isSourceSeparationEnabled(), j.getTtsVoiceId(),
                j.isVisualContextEnabled(), j.getPresetId(), j.getWorkflowMode().name(),
                j.getPerformedByUserId(), j.getCreatedByUserId(), j.getCreatedAt(), j.getUpdatedAt(), stages);
    }
}
