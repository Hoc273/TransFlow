package com.app.modules.summarization.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/** {@code POST/PUT .../proposals/custom} body (API_Contract.md §5.1). */
public record CustomProposalRequest(
        @NotEmpty List<SegmentRange> segments,
        String reasoningNote
) {
}
