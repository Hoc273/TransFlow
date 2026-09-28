package com.app.modules.media_asset.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/** {@code POST .../media/uploads} (API_Contract.md §4). */
public record UploadSessionRequest(
        @NotBlank @Size(max = 1000) String fileName,
        @Positive long fileSizeBytes,
        @NotBlank @Size(max = 255) String contentType
) {
}
