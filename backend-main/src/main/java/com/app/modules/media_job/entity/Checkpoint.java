package com.app.modules.media_job.entity;

/**
 * Manual-workflow checkpoint markers (System_Architecture.md §5.6). Persisted into the
 * {@code input_ref} JSONB of the stage that "owns" the checkpoint — mapping below is this
 * module's own reasonable default (not pinned verbatim in SRS/Arch §14); confirm with BA
 * before relying on it for FE stage-halting behavior.
 */
public enum Checkpoint {
    CUT_CONFIRMED(MediaJobStage.StageName.TRANSLATE),
    REVIEW_CONFIRMED(MediaJobStage.StageName.TTS),
    PUBLISH_CONFIRMED(MediaJobStage.StageName.RENDER);

    private final MediaJobStage.StageName ownerStage;

    Checkpoint(MediaJobStage.StageName ownerStage) {
        this.ownerStage = ownerStage;
    }

    public MediaJobStage.StageName ownerStage() {
        return ownerStage;
    }

    @com.fasterxml.jackson.annotation.JsonCreator
    public static Checkpoint fromString(String val) {
        if (val == null || val.isBlank()) {
            throw new com.app.common.exception.AppException(com.app.common.exception.ErrorCode.VALIDATION_ERROR);
        }
        String clean = val.trim().toUpperCase();
        return switch (clean) {
            case "CUT", "CUT_CONFIRMED" -> CUT_CONFIRMED;
            case "REVIEW", "REVIEW_CONFIRMED" -> REVIEW_CONFIRMED;
            case "PUBLISH", "EXPORT", "PUBLISH_CONFIRMED" -> PUBLISH_CONFIRMED;
            default -> {
                try {
                    yield Checkpoint.valueOf(clean);
                } catch (IllegalArgumentException e) {
                    throw new com.app.common.exception.AppException(com.app.common.exception.ErrorCode.VALIDATION_ERROR);
                }
            }
        };
    }
}
