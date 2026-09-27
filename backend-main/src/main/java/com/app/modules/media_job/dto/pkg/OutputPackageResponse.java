package com.app.modules.media_job.dto.pkg;

import java.util.List;
import java.util.UUID;

/**
 * {@code GET .../output-package}: technical view of a finished render for the Quick Preview modal.
 * Field set follows the frontend type {@code OutputPackage}; {@code downloadUrl} on audio tracks is additive
 * (presigned, so clients never need the raw storage ref).
 */
public record OutputPackageResponse(
        UUID jobId,
        String primaryVideoRef,
        String primaryVideoDownloadUrl,
        List<AudioTrack> audioTracks,
        List<SubtitleTrack> subtitleTracks,
        Long durationMs,
        String checksumSha256,
        List<String> artifactPins) {

    /** {@code role}: ORIGINAL (source audio kept, no ref) | DUB | MIX. */
    public record AudioTrack(String role, String storageRef, String downloadUrl) {
    }

    public record SubtitleTrack(String format, String language, boolean available) {
    }
}
