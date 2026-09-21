package com.app.modules.media_job.dto.pkg;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * {@code PUT .../publish-package} body; null field = keep stored value. Also the persisted shape of
 * {@code media_jobs.publish_package} (already merged, so stored nulls mean "unset").
 * ponytail: {@code language} is only format-checked (no supported-language list yet); tags/thumbnail cannot be cleared to null.
 */
public record UpdatePublishPackageRequest(
        @Size(max = 100) String title,
        @Size(max = 5000) String description,
        @Pattern(regexp = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$") String language,
        @Size(max = 30) List<@Size(max = 50) String> tags,
        @Size(max = 1000) String thumbnailRef) {

    /** Field-wise overlay: values in {@code patch} win, nulls fall back to this (stored) draft. */
    public UpdatePublishPackageRequest merge(UpdatePublishPackageRequest patch) {
        return new UpdatePublishPackageRequest(
                pick(patch.title, title), pick(patch.description, description), pick(patch.language, language),
                pick(patch.tags, tags), pick(patch.thumbnailRef, thumbnailRef));
    }

    private static <T> T pick(T patch, T stored) {
        return patch != null ? patch : stored;
    }
}
