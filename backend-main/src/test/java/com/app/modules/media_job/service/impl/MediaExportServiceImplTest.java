package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.dto.MediaExportResponse;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.service.QaService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MediaExportServiceImplTest {

    @Mock private MediaJobService jobService;
    @Mock private QaService qaService;
    @Mock private MediaStorageService storage;

    private MediaExportServiceImpl service;
    private final UUID ws = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private final UUID jobId = UUID.randomUUID();
    private MediaJob job;

    @BeforeEach
    void setUp() {
        service = new MediaExportServiceImpl(jobService, qaService, storage);
        job = new MediaJob();
        job.setStatus(MediaJob.JobStatus.COMPLETED);
        lenient().when(jobService.getJob(ws, user, jobId)).thenReturn(job);
        lenient().when(qaService.listIssues(ws, user, jobId, false)).thenReturn(List.of());
    }

    private static AppException expectError(Runnable r) {
        return assertThrows(AppException.class, r::run);
    }

    private static SubtitleSegment seg(long start, long end, String text) {
        SubtitleSegment s = new SubtitleSegment();
        s.setStartMs(start);
        s.setEndMs(end);
        s.setTargetText(text);
        return s;
    }

    private static MediaJobStage renderStage(String outputRef) {
        MediaJobStage s = new MediaJobStage();
        s.setStageName(MediaJobStage.StageName.RENDER);
        s.setStatus(MediaJobStage.StageStatus.COMPLETED);
        s.setOutputRef(outputRef);
        return s;
    }

    @Test
    void invalidFormat_isValidationError() {
        assertEquals(ErrorCode.VALIDATION_ERROR,
                expectError(() -> service.export(ws, user, jobId, "GIF")).getErrorCode());
        verifyNoInteractions(jobService);
    }

    @Test
    void jobNotCompleted_isStageNotReady() {
        job.setStatus(MediaJob.JobStatus.PROCESSING);
        assertEquals(ErrorCode.STAGE_NOT_READY,
                expectError(() -> service.export(ws, user, jobId, "VIDEO")).getErrorCode());
    }

    @Test
    void unresolvedBlockPublishIssue_isQaBlocked() {
        QaIssue issue = new QaIssue();
        issue.setBlockingActions(List.of("BLOCK_PUBLISH"));
        when(qaService.listIssues(ws, user, jobId, false)).thenReturn(List.of(issue));
        assertEquals(ErrorCode.QA_BLOCKED,
                expectError(() -> service.export(ws, user, jobId, "SUBTITLE")).getErrorCode());
    }

    @Test
    void issueBlockingOnlyRender_doesNotBlockExport() {
        QaIssue issue = new QaIssue();
        issue.setBlockingActions(List.of("BLOCK_RENDER"));
        when(qaService.listIssues(ws, user, jobId, false)).thenReturn(List.of(issue));
        when(jobService.listSubtitles(ws, user, jobId)).thenReturn(List.of());
        assertEquals("SUBTITLE", service.export(ws, user, jobId, "subtitle").format());
    }

    @Test
    void subtitle_buildsSrt() {
        when(jobService.listSubtitles(ws, user, jobId))
                .thenReturn(List.of(seg(0, 1500, "Hello"), seg(3_723_004, 3_725_000, "World")));

        MediaExportResponse res = service.export(ws, user, jobId, "SUBTITLE");

        assertEquals("1\n00:00:00,000 --> 00:00:01,500\nHello\n\n"
                + "2\n01:02:03,004 --> 01:02:05,000\nWorld\n\n", res.content());
        assertNull(res.downloadUrl());
    }

    @Test
    void srt_isSameAsSubtitleAlias_andVtt_usesWebVttHeaderAndDotMillis() {
        when(jobService.listSubtitles(ws, user, jobId))
                .thenReturn(List.of(seg(0, 1500, "Hello"), seg(3_723_004, 3_725_000, "World")));

        assertEquals(service.export(ws, user, jobId, "SUBTITLE").content(), service.export(ws, user, jobId, "srt").content());

        MediaExportResponse vtt = service.export(ws, user, jobId, "vtt");
        assertEquals("WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello\n\n"
                + "01:02:03.004 --> 01:02:05.000\nWorld\n\n", vtt.content());
        assertEquals("subtitles_" + jobId + ".vtt", vtt.fileName());
    }

    @Test
    void video_presignsRenderOutputRef_storedAsJsonText() {
        when(jobService.getStages(jobId)).thenReturn(List.of(renderStage("\"transflow-media/rendered/j1/abc.mp4\"")));
        when(storage.presignedGetUrl("transflow-media/rendered/j1/abc.mp4")).thenReturn("http://minio/signed");

        MediaExportResponse res = service.export(ws, user, jobId, "video");

        assertEquals("http://minio/signed", res.downloadUrl());
        assertEquals("abc.mp4", res.fileName());
        assertNull(res.content());
    }

    @Test
    void video_presignsRenderOutputRef_fromWorkerCallbackObject() {
        when(jobService.getStages(jobId)).thenReturn(List.of(renderStage(
                "{\"objectRef\":\"transflow-media/rendered/j1/finished.mp4\",\"mediaProbe\":{\"durationMs\":97250}}")));
        when(storage.presignedGetUrl("transflow-media/rendered/j1/finished.mp4")).thenReturn("http://minio/signed");

        MediaExportResponse res = service.export(ws, user, jobId, "VIDEO");

        assertEquals("http://minio/signed", res.downloadUrl());
        assertEquals("finished.mp4", res.fileName());
    }

    @Test
    void video_withoutRenderOutput_isStageNotReady() {
        when(jobService.getStages(jobId)).thenReturn(List.of());
        assertEquals(ErrorCode.STAGE_NOT_READY,
                expectError(() -> service.export(ws, user, jobId, "VIDEO")).getErrorCode());
    }
}
