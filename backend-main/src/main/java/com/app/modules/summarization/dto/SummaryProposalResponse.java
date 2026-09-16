package com.app.modules.summarization.dto;

import com.app.modules.summarization.entity.SummaryProposal;
import com.fasterxml.jackson.annotation.JsonRawValue;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record SummaryProposalResponse(
        UUID id,
        String generatedBy,
        short generationRound,
        String feedbackText,
        String scriptContent,
        String scriptLanguage,
        String reasoningNote,
        Long totalDurationMs,
        BigDecimal confidence,
        @JsonRawValue String warnings,
        Instant archivedAt,
        Instant createdAt,
        List<SummaryProposalSegmentResponse> segments
) {
    public static SummaryProposalResponse from(SummaryProposal p, List<SummaryProposalSegmentResponse> segments) {
        return new SummaryProposalResponse(p.getId(), p.getGeneratedBy().name(), p.getGenerationRound(),
                p.getFeedbackText(), p.getScriptContent(), p.getScriptLanguage(), p.getReasoningNote(),
                p.getTotalDurationMs(), p.getConfidence(), p.getWarnings(), p.getArchivedAt(), p.getCreatedAt(),
                segments);
    }
}
