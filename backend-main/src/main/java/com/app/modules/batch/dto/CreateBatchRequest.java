package com.app.modules.batch.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import java.util.UUID;

/** {@code POST .../projects/{projectId}/batches} body (API_Contract.md §6). */
public record CreateBatchRequest(
        String name,
        @NotEmpty List<UUID> sourceAssetIds,
        @NotBlank String targetLang,
        @Valid SharedJobConfig sharedConfig
) {
}
