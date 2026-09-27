package com.app.modules.summarization.service;

import java.util.UUID;

/** Optional extension for refine calls so provider resolution retains the current user. */
public interface UserAwareDurationSummaryAiClient extends DurationAwareSummaryAiClient {

    SummaryAiClient.ScriptProposalResult refineScript(
            String previousScript, String feedbackText, String targetLang,
            int requestedDurationSeconds, UUID userId);

    /** Variant used by the public refine flow so FastAPI can correlate the request to the job. */
    default SummaryAiClient.ScriptProposalResult refineScript(
            String previousScript, String feedbackText, String targetLang,
            int requestedDurationSeconds, UUID mediaJobId, UUID userId) {
        return refineScript(previousScript, feedbackText, targetLang, requestedDurationSeconds, userId);
    }
}
