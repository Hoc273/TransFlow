package com.app.modules.media_job.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

/** {@code PUT .../segments/batch} body (API_Contract.md §5) — per item, null field = keep current value. */
public record BatchEditSegmentsRequest(@NotEmpty @Valid List<Item> updates) {

    public record Item(@NotNull UUID segmentId, String targetText, Long startMs, Long endMs) {
    }
}
