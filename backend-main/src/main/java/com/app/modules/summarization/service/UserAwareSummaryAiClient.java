package com.app.modules.summarization.service;

import java.util.UUID;

/** Optional extension allowing the pipeline worker to resolve the job owner's BYOK provider. */
public interface UserAwareSummaryAiClient {

    SummaryAiClient.ScriptProposalResult generateScript(
            String transcript, String visualContext, int requestedDurationSeconds,
            String targetLang, UUID userId);

    /** Variant used by the stage executor so FastAPI receives the real job id for tracing. */
    default SummaryAiClient.ScriptProposalResult generateScript(
            String transcript, String visualContext, int requestedDurationSeconds,
            String targetLang, UUID mediaJobId, UUID userId) {
        return generateScript(transcript, visualContext, requestedDurationSeconds, targetLang, userId);
    }

    /**
     * Variant carrying the voice's calibrated reading rate (chars/s) so the writer
     * sizes the narration to the requested duration; {@code null} uses the gateway default.
     */
    default SummaryAiClient.ScriptProposalResult generateScript(
            String transcript, String visualContext, int requestedDurationSeconds,
            String targetLang, UUID mediaJobId, UUID userId, Double narrationCps) {
        return generateScript(transcript, visualContext, requestedDurationSeconds, targetLang, mediaJobId, userId);
    }
}
