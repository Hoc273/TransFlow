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
}
