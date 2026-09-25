package com.app.modules.credit.service.impl;

import com.app.modules.credit.entity.AiUsageLogEntry;
import com.app.modules.credit.repository.AiUsageLogEntryRepository;
import com.app.modules.credit.service.AiUsageLogService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Service
public class AiUsageLogServiceImpl implements AiUsageLogService {

    private final AiUsageLogEntryRepository repository;

    public AiUsageLogServiceImpl(AiUsageLogEntryRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public void record(UUID workspaceId, UUID projectId, UUID mediaJobId, UUID performedByUserId,
                       String operation, boolean usedPersonalApiKey, long inputTokens, long outputTokens,
                       BigDecimal creditUsed) {
        AiUsageLogEntry entry = new AiUsageLogEntry();
        entry.setWorkspaceId(workspaceId);
        entry.setProjectId(projectId);
        entry.setMediaJobId(mediaJobId);
        entry.setPerformedByUserId(performedByUserId);
        entry.setOperation(operation);
        entry.setUsedPersonalApiKey(usedPersonalApiKey);
        entry.setInputTokens(toInt(inputTokens));
        entry.setOutputTokens(toInt(outputTokens));
        entry.setCreditUsed(creditUsed == null ? BigDecimal.ZERO : creditUsed);
        entry.setCreatedAt(Instant.now());
        repository.save(entry);
    }

    private int toInt(long value) {
        return (int) Math.min(Integer.MAX_VALUE, Math.max(0L, value));
    }
}
