package com.app.modules.media_job.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Helpers for exposing only object storage references from stage outputs. */
public final class StageOutputRefs {

    private static final ObjectMapper JSON = new ObjectMapper();

    private StageOutputRefs() {
    }

    public static String storageRef(String rawOutputRef) {
        if (rawOutputRef == null || rawOutputRef.isBlank()) {
            return null;
        }

        try {
            JsonNode node = JSON.readTree(rawOutputRef);
            String ref = null;
            if (node != null && node.isTextual()) {
                ref = node.asText();
            } else if (node != null && node.isObject()) {
                JsonNode objectRef = node.get("objectRef");
                if (objectRef != null && objectRef.isTextual()) {
                    ref = objectRef.asText();
                }
            }
            return ref == null || ref.isBlank() ? null : ref;
        } catch (Exception ignored) {
            return looksLikeStorageRef(rawOutputRef) ? rawOutputRef : null;
        }
    }

    private static boolean looksLikeStorageRef(String value) {
        return value.contains("/")
                && !value.contains("{")
                && value.chars().noneMatch(Character::isWhitespace);
    }
}
