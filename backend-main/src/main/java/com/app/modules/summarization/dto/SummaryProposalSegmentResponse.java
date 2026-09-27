package com.app.modules.summarization.dto;

import com.app.modules.summarization.entity.SummaryProposalSegment;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonRawValue;

import java.util.UUID;

public record SummaryProposalSegmentResponse(
        UUID id,
        int seq,
        long startMs,
        long endMs,
        String scriptExcerpt,
        @JsonRawValue String sourceSentenceRefs,
        String reasoningNote
) {
    @JsonProperty("start_ms")
    public long getStartMsSnake() {
        return startMs;
    }

    @JsonProperty("end_ms")
    public long getEndMsSnake() {
        return endMs;
    }

    public static SummaryProposalSegmentResponse from(SummaryProposalSegment s) {
        return new SummaryProposalSegmentResponse(s.getId(), s.getSeq(), s.getStartMs(), s.getEndMs(),
                s.getScriptExcerpt(), s.getSourceSentenceRefs(), s.getReasoningNote());
    }
}
