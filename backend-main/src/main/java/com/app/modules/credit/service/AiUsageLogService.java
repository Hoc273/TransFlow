package com.app.modules.credit.service;

import java.math.BigDecimal;
import java.util.UUID;

/** Public write boundary for pipeline usage records; dashboard remains read-only. */
public interface AiUsageLogService {

    void record(UUID workspaceId, UUID projectId, UUID mediaJobId, UUID performedByUserId,
                String operation, boolean usedPersonalApiKey, long unitsUsed, BigDecimal creditUsed);
}
