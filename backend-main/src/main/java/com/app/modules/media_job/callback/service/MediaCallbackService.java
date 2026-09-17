package com.app.modules.media_job.callback.service;

import com.app.modules.media_job.entity.MediaJobStage;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.UUID;

/**
 * Worker -> Spring callback for the 4 FFmpeg-driven stages (EXTRACT_AUDIO, SOURCE_SEPARATION, AUDIO_MIX,
 * RENDER) — API_Contract.md §14, Backend_Java_TaskSplit_MemberB.md §2.7. HMAC verification and dedupe are
 * handled by the controller before these methods run; these methods only mutate job/stage state.
 */
public interface MediaCallbackService {

    void updateProgress(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage, short progressPercent);

    void completeStage(UUID jobId, UUID stageId, MediaJobStage.StageName expectedStage,
                        boolean success, JsonNode outputRef, String errorMessage);
}
