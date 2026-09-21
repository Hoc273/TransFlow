package com.app.modules.media_job.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.UUID;

/** {@code POST .../projects/{projectId}/media/jobs/download} body (API_Contract.md §5). */
public record BulkDownloadRequest(@NotEmpty List<@NotNull UUID> jobIds) {
}
