package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.dto.MediaExportResponse;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.service.MediaExportService;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.media_job.util.StageOutputRefs;
import com.app.modules.qa.service.QaService;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class MediaExportServiceImpl implements MediaExportService {

    private static final String BLOCK_PUBLISH = "BLOCK_PUBLISH";

    private final MediaJobService jobService;
    private final QaService qaService;
    private final MediaStorageService storage;

    public MediaExportServiceImpl(MediaJobService jobService, QaService qaService,
                                  MediaStorageService storage) {
        this.jobService = jobService;
        this.qaService = qaService;
        this.storage = storage;
    }

    @Override
    public MediaExportResponse export(UUID workspaceId, UUID userId, UUID jobId, String format) {
        String fmt = format == null ? "" : format.toUpperCase(Locale.ROOT);
        if (!List.of("VIDEO", "SUBTITLE", "SRT", "VTT").contains(fmt)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        if (!fmt.equals("VIDEO")) { // SUBTITLE is the legacy alias of SRT
            checkSubtitlesReady(workspaceId, userId, jobId);
            boolean vtt = fmt.equals("VTT");
            String rendered = renderedSubtitle(jobId, vtt);
            String content = rendered != null ? rendered : vtt
                    ? toVtt(jobService.listSubtitles(workspaceId, userId, jobId))
                    : toSrt(jobService.listSubtitles(workspaceId, userId, jobId));
            return new MediaExportResponse(fmt, "subtitles_" + jobId + (vtt ? ".vtt" : ".srt"), null, content);
        }

        String ref = renderOutputRef(workspaceId, userId, jobId);
        if (storage.objectMissing(ref)) {
            throw new AppException(ErrorCode.MEDIA_FILE_EXPIRED);
        }
        return new MediaExportResponse(fmt, ref.substring(ref.lastIndexOf('/') + 1), storage.presignedGetUrl(ref), null);
    }

    @Override
    public String renderOutputRef(UUID workspaceId, UUID userId, UUID jobId) {
        checkPublishable(workspaceId, userId, jobId);
        return jobService.getStages(jobId).stream()
                .filter(s -> s.getStageName() == MediaJobStage.StageName.RENDER
                        && s.getStatus() == MediaJobStage.StageStatus.COMPLETED)
                .map(s -> parseRef(s.getOutputRef()))
                .filter(r -> r != null && !r.isBlank())
                .findFirst()
                .orElseThrow(() -> new AppException(ErrorCode.STAGE_NOT_READY));
    }

    /** getJob enforces project access (LEAD/MEMBER/CLIENT may all read a published result). */
    private void checkPublishable(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = jobService.getJob(workspaceId, userId, jobId);
        if (job.getStatus() != MediaJob.JobStatus.COMPLETED) {
            throw new AppException(ErrorCode.STAGE_NOT_READY);
        }

        requirePublishAllowed(workspaceId, userId, jobId);
    }

    /**
     * Subtitle files come from the job's segments, which TRANSLATE materialises — they do not wait for
     * RENDER / job completion. The QA publish gate still applies.
     */
    private void checkSubtitlesReady(UUID workspaceId, UUID userId, UUID jobId) {
        jobService.getJob(workspaceId, userId, jobId); // project read access
        boolean translated = jobService.getStages(jobId).stream()
                .anyMatch(s -> s.getStageName() == MediaJobStage.StageName.TRANSLATE
                        && s.getStatus() == MediaJobStage.StageStatus.COMPLETED);
        if (!translated) {
            throw new AppException(ErrorCode.STAGE_NOT_READY);
        }
        requirePublishAllowed(workspaceId, userId, jobId);
    }

    @Override
    public void requirePublishAllowed(UUID workspaceId, UUID userId, UUID jobId) {
        // Unresolved (not fixed / not overridden) issues that block publishing — SRS §5.3.
        boolean blocked = qaService.listIssues(workspaceId, userId, jobId, false).stream()
                .anyMatch(i -> i.getBlockingActions() != null && i.getBlockingActions().contains(BLOCK_PUBLISH));
        if (blocked) {
            throw new AppException(ErrorCode.QA_BLOCKED);
        }
    }

    /**
     * The sidecar the current render burned/muxed. Rows keep source-timeline times, while a
     * summary render concatenates cuts or retimes footage to narration, so only the sidecar
     * matches the exported video. Editing subtitles marks RENDER stale, which falls back to rows.
     */
    private String renderedSubtitle(UUID jobId, boolean vtt) {
        String ref = jobService.getStages(jobId).stream()
                .filter(s -> s.getStageName() == MediaJobStage.StageName.RENDER
                        && s.getStatus() == MediaJobStage.StageStatus.COMPLETED)
                .map(s -> StageOutputRefs.field(s.getOutputRef(), vtt ? "vttRef" : "srtRef"))
                .filter(r -> r != null && !r.isBlank())
                .findFirst()
                .orElse(null);
        if (ref == null) {
            return null;
        }
        try (java.io.InputStream in = storage.getMediaObject(ref)) {
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ex) {
            return null; // the rows remain a valid (source-timeline) export
        }
    }

    static String parseRef(String outputRef) {
        return StageOutputRefs.storageRef(outputRef);
    }

    static String toSrt(List<SubtitleSegment> segments) {
        StringBuilder sb = new StringBuilder();
        int n = 1;
        for (SubtitleSegment s : segments) {
            sb.append(n++).append('\n')
              .append(srtTime(s.getStartMs())).append(" --> ").append(srtTime(s.getEndMs())).append('\n')
              .append(s.getTargetText()).append("\n\n");
        }
        return sb.toString();
    }

    /** WebVTT: {@code WEBVTT} header, cue times use '.' before the milliseconds. */
    static String toVtt(List<SubtitleSegment> segments) {
        StringBuilder sb = new StringBuilder("WEBVTT\n\n");
        for (SubtitleSegment s : segments) {
            sb.append(vttTime(s.getStartMs())).append(" --> ").append(vttTime(s.getEndMs())).append('\n')
              .append(s.getTargetText()).append("\n\n");
        }
        return sb.toString();
    }

    private static String srtTime(long ms) {
        return vttTime(ms).replace('.', ',');
    }

    private static String vttTime(long ms) {
        return String.format("%02d:%02d:%02d.%03d", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
    }
}
