package com.app.modules.media_asset.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Body of {@code POST .../media/assets/{assetId}/consent} (API_Contract.md §4) —
 * termsVersion must match {@code terms_versions.is_current} at the time of the call.
 */
public record ConsentRequest(@NotBlank String termsVersion) {
}
