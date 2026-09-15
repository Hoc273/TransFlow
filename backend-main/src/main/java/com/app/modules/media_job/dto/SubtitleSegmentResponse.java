package com.app.modules.media_job.dto;

import com.app.modules.media_job.entity.SubtitleSegment;

import java.util.UUID;

public record SubtitleSegmentResponse(
        UUID id,
        int seq,
        String contentSource,
        String sourceText,
        String targetText,
        long startMs,
        long endMs,
        String ttsAudioRef
) {
    public static SubtitleSegmentResponse from(SubtitleSegment s) {
        return new SubtitleSegmentResponse(s.getId(), s.getSeq(), s.getContentSource().name(),
                s.getSourceText(), s.getTargetText(), s.getStartMs(), s.getEndMs(), s.getTtsAudioRef());
    }
}
