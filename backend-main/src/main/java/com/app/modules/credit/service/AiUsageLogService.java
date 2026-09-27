package com.app.modules.credit.service;

import java.math.BigDecimal;
import java.util.UUID;

/** Public write boundary for pipeline usage records; dashboard remains read-only. */
public interface AiUsageLogService {

    void record(UUID workspaceId, UUID projectId, UUID mediaJobId, UUID performedByUserId,
                String operation, boolean usedPersonalApiKey, long inputTokens, long outputTokens,
                BigDecimal creditUsed);

    /** Same as {@link #record} and also attributes the row to the provider that served it. */
    default void record(UUID workspaceId, UUID projectId, UUID mediaJobId, UUID performedByUserId,
                        String operation, boolean usedPersonalApiKey, long inputTokens, long outputTokens,
                        BigDecimal creditUsed, UUID providerId) {
        record(workspaceId, projectId, mediaJobId, performedByUserId, operation, usedPersonalApiKey,
                inputTokens, outputTokens, creditUsed);
    }
}
