package com.app.modules.media_job.dto;

/**
 * Result of {@code GET .../media/jobs/{jobId}/export} (API_Contract.md §5).
 * VIDEO: {@code downloadUrl} is set; SUBTITLE: {@code content} holds the SRT text.
 */
public record MediaExportResponse(String format, String fileName, String downloadUrl, String content) {
}
