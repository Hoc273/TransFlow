package com.app.modules.summarization.service.impl;

import com.app.modules.summarization.service.SummaryAiClient;
import org.springframework.stereotype.Service;

/**
 * Placeholder — see {@link SummaryAiClient} javadoc. Throws until the real backend-ai HTTP client exists;
 * tests supply a mock/stub instead of exercising this bean.
 */
@Service
public class SummaryAiClientImpl implements SummaryAiClient {

    @Override
    public ScriptProposalResult generateScript(String transcript, String visualContext, int requestedDurationSeconds, String targetLang) {
        throw new UnsupportedOperationException("SummaryAiClient.generateScript is not implemented yet (backend-ai integration)");
    }

    @Override
    public ScriptProposalResult refineScript(String previousScript, String feedbackText, String targetLang) {
        throw new UnsupportedOperationException("SummaryAiClient.refineScript is not implemented yet (backend-ai integration)");
    }
}
