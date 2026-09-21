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
import com.app.modules.qa.service.QaService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final ObjectMapper objectMapper;

    public MediaExportServiceImpl(MediaJobService jobService, QaService qaService,
                                  MediaStorageService storage, ObjectMapper objectMapper) {
        this.jobService = jobService;
        this.qaService = qaService;
        this.storage = storage;
        this.objectMapper = objectMapper;
    }

    @Override
    public MediaExportResponse export(UUID workspaceId, UUID userId, UUID jobId, String format) {
        String fmt = format == null ? "" : format.toUpperCase(Locale.ROOT);
        if (!fmt.equals("VIDEO") && !fmt.equals("SUBTITLE")) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        if (fmt.equals("SUBTITLE")) {
            checkPublishable(workspaceId, userId, jobId);
            String srt = toSrt(jobService.listSubtitles(workspaceId, userId, jobId));
            return new MediaExportResponse(fmt, "subtitles_" + jobId + ".srt", null, srt);
        }

        String ref = renderOutputRef(workspaceId, userId, jobId);
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

        // Unresolved (not fixed / not overridden) issues that block publishing — SRS §5.3.
        boolean blocked = qaService.listIssues(workspaceId, userId, jobId, false).stream()
                .anyMatch(i -> i.getBlockingActions() != null && i.getBlockingActions().contains(BLOCK_PUBLISH));
        if (blocked) {
            throw new AppException(ErrorCode.QA_BLOCKED);
        }
    }

    /** Stage {@code output_ref} is JSON text holding the worker's {@code "<bucket>/<key>"} string. */
    private String parseRef(String outputRef) {
        if (outputRef == null) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(outputRef);
            return node.isTextual() ? node.asText() : null;
        } catch (Exception ex) {
            return outputRef;
        }
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

    private static String srtTime(long ms) {
        return String.format("%02d:%02d:%02d,%03d", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
    }
}
