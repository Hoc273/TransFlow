package com.app.modules.summarization.service;

/** Optional extension used by the real HTTP client to preserve job duration during refine. */
public interface DurationAwareSummaryAiClient {

    SummaryAiClient.ScriptProposalResult refineScript(
            String previousScript, String feedbackText, String targetLang, int requestedDurationSeconds);
}
