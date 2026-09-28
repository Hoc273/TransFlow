package com.app.modules.media_asset.dto;

import jakarta.validation.constraints.Size;

/** Optional display name override for {@code POST .../media/uploads/{uploadId}/complete}. */
public record CompleteUploadRequest(@Size(max = 1000) String name) {
}
