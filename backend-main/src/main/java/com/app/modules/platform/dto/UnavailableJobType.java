package com.app.modules.platform.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Placeholder for job types that do not exist in the mini scope
 * (text/document translation, creative production — SRS §4.3).
 * Serializes as {@code {"available": false}} so the FE overview page
 * renders an explicit "unavailable" card instead of fake zeros.
 */
public record UnavailableJobType(
        @JsonProperty("available") boolean available
) {
    public static final UnavailableJobType INSTANCE = new UnavailableJobType(false);
}
