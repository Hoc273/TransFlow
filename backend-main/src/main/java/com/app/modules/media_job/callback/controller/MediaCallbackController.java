package com.app.modules.media_job.callback.controller;

import com.app.common.config.AppProperties;
import com.app.common.dto.ApiResponse;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_job.callback.dto.CompleteCallback;
import com.app.modules.media_job.callback.dto.ProgressCallback;
import com.app.modules.media_job.callback.service.CallbackDedupeStore;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.callback.util.HmacVerifier;
import com.app.modules.media_job.entity.MediaJobStage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Worker -> Spring callback for the 4 FFmpeg-driven stages (API_Contract.md §14,
 * Backend_Java_TaskSplit_MemberB.md §2.7). No JWT — authenticated by HMAC-SHA256 over the raw body
 * (see {@link HmacVerifier}), idempotent per {@code dedupeKey}. {@code {stage}} matches the same path
 * segments the doc itself uses: extract-audio, source-separation, audio-mix, render.
 */
@RestController
@RequestMapping("/internal/media")
public class MediaCallbackController {

    private static final Map<String, MediaJobStage.StageName> STAGE_PATHS = Map.of(
            "extract-audio", MediaJobStage.StageName.EXTRACT_AUDIO,
            "source-separation", MediaJobStage.StageName.SOURCE_SEPARATION,
            "audio-mix", MediaJobStage.StageName.AUDIO_MIX,
            "render", MediaJobStage.StageName.RENDER
    );

    private final MediaCallbackService callbackService;
    private final CallbackDedupeStore dedupeStore;
    private final ObjectMapper objectMapper;
    private final AppProperties props;

    public MediaCallbackController(MediaCallbackService callbackService, CallbackDedupeStore dedupeStore,
                                    ObjectMapper objectMapper, AppProperties props) {
        this.callbackService = callbackService;
        this.dedupeStore = dedupeStore;
        this.objectMapper = objectMapper;
        this.props = props;
    }

    @PostMapping("/{stage}/progress")
    public ApiResponse<Void> progress(@PathVariable String stage,
                                       @RequestBody String rawBody,
                                       @RequestHeader("X-Signature") String signature,
                                       @RequestHeader("X-Timestamp") long timestamp) {
        MediaJobStage.StageName stageName = resolveStage(stage);
        HmacVerifier.verify(props.mediaWorker().hmacSecret(), rawBody, timestamp, signature);
        ProgressCallback payload = parse(rawBody, ProgressCallback.class);

        if (!dedupeStore.isProcessed(payload.dedupeKey())) {
            callbackService.updateProgress(payload.jobId(), payload.stageId(), stageName, payload.progressPercent());
            dedupeStore.markProcessed(payload.dedupeKey());
        }
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping("/{stage}/complete")
    public ApiResponse<Void> complete(@PathVariable String stage,
                                       @RequestBody String rawBody,
                                       @RequestHeader("X-Signature") String signature,
                                       @RequestHeader("X-Timestamp") long timestamp) {
        MediaJobStage.StageName stageName = resolveStage(stage);
        HmacVerifier.verify(props.mediaWorker().hmacSecret(), rawBody, timestamp, signature);
        CompleteCallback payload = parse(rawBody, CompleteCallback.class);

        if (!dedupeStore.isProcessed(payload.dedupeKey())) {
            callbackService.completeStage(payload.jobId(), payload.stageId(), stageName,
                    payload.success(), payload.outputRef(), payload.errorMessage());
            dedupeStore.markProcessed(payload.dedupeKey());
        }
        return ApiResponse.<Void>builder().build();
    }

    private MediaJobStage.StageName resolveStage(String stage) {
        MediaJobStage.StageName stageName = STAGE_PATHS.get(stage);
        if (stageName == null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        return stageName;
    }

    private <T> T parse(String rawBody, Class<T> type) {
        try {
            return objectMapper.readValue(rawBody, type);
        } catch (Exception e) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
    }
}
