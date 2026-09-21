package com.app.modules.media_job.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.dto.render.RenderConfigResponse;
import com.app.modules.media_job.dto.render.UpdateRenderConfigRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.media_job.service.MediaRenderConfigService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class MediaRenderConfigServiceImpl implements MediaRenderConfigService {

    private static final Logger log = LoggerFactory.getLogger(MediaRenderConfigServiceImpl.class);

    private final MediaJobService jobService;
    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final MediaAssetService assetService;
    private final MediaStorageService storage;
    private final AppProperties props;
    private final ObjectMapper objectMapper;

    public MediaRenderConfigServiceImpl(MediaJobService jobService, MediaJobRepository jobRepository,
                                        MediaJobStageRepository stageRepository, MediaAssetService assetService,
                                        MediaStorageService storage, AppProperties props, ObjectMapper objectMapper) {
        this.jobService = jobService;
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.assetService = assetService;
        this.storage = storage;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public RenderConfigResponse get(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = jobService.getJob(workspaceId, userId, jobId); // any role in the project may read
        return toResponse(workspaceId, userId, job);
    }

    @Override
    @Transactional
    public RenderConfigResponse update(UUID workspaceId, UUID userId, UUID jobId, UpdateRenderConfigRequest request) {
        MediaJob job = save(workspaceId, userId, jobId, request);
        return toResponse(workspaceId, userId, job);
    }

    @Override
    @Transactional
    public MediaJob rerunRender(UUID workspaceId, UUID userId, UUID jobId, UpdateRenderConfigRequest request) {
        if (request != null) {
            save(workspaceId, userId, jobId, request);
        } else {
            jobService.requireJobOwnership(workspaceId, userId, jobService.getJob(workspaceId, userId, jobId));
        }
        // reuse the shared rerun logic: locks the job, requires earlier stages COMPLETED/SKIPPED (else STAGE_NOT_READY)
        return jobService.rerunFromStage(workspaceId, userId, jobId, MediaJobStage.StageName.RENDER);
    }

    /** Locks the job, enforces ownership, merges + stores the config, stales a finished RENDER stage. */
    private MediaJob save(UUID workspaceId, UUID userId, UUID jobId, UpdateRenderConfigRequest patch) {
        MediaJob job = jobRepository.findWithLockById(jobId)
                .filter(j -> j.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        jobService.requireJobOwnership(workspaceId, userId, job);

        job.setRenderConfig(write(readStored(job).merge(patch)));
        jobRepository.save(job);

        stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER)
                .filter(s -> s.getStatus() == MediaJobStage.StageStatus.COMPLETED)
                .ifPresent(s -> {
                    s.setStatus(MediaJobStage.StageStatus.STALE);
                    stageRepository.save(s);
                });
        return job;
    }

    private RenderConfigResponse toResponse(UUID workspaceId, UUID userId, MediaJob job) {
        UpdateRenderConfigRequest c = readStored(job);
        String position = c.subtitlePosition() != null ? c.subtitlePosition() : "BOTTOM";
        int offset = c.verticalOffsetPercent() != null ? c.verticalOffsetPercent() : 0;
        boolean box = Boolean.TRUE.equals(c.backgroundBox());
        // ponytail: no SubtitleStyle yet (§4) => ownedByStyle=false, no dead controls; revisit with subtitle-styles
        int base = switch (position) {
            case "TOP" -> 10;
            case "CENTER" -> 50;
            default -> 88;
        };
        var effective = new RenderConfigResponse.Effective(box, false, Math.max(3, Math.min(95, base + offset)), List.of());

        return new RenderConfigResponse(
                c.subtitleMode() != null ? c.subtitleMode() : job.getSubtitleMode().name(),
                position, offset, box, c.backgroundColor(), c.textColor(),
                c.outputAspectRatio() != null ? c.outputAspectRatio() : "ORIGINAL",
                confirmed(job.getId()), sourceVideoUrl(workspaceId, userId, job),
                props.storage().presignedTtlSeconds(), c.presentation(), effective);
    }

    private boolean confirmed(UUID jobId) {
        return stageRepository.findByMediaJobIdAndStageName(jobId, Checkpoint.PUBLISH_CONFIRMED.ownerStage())
                .map(s -> s.getInputRef() != null && s.getInputRef().contains(Checkpoint.PUBLISH_CONFIRMED.name()))
                .orElse(false);
    }

    /** Best effort: a storage hiccup must not make the config unreadable. */
    private String sourceVideoUrl(UUID workspaceId, UUID userId, MediaJob job) {
        try {
            MediaAsset asset = assetService.getAsset(workspaceId, userId, job.getRootAssetId());
            return storage.presignedGetUrl(asset.getBucketName() + "/" + asset.getObjectStorageKey());
        } catch (AppException ex) {
            log.warn("render-config: cannot sign source video for job={}: {}", job.getId(), ex.getMessage());
            return null;
        }
    }

    private UpdateRenderConfigRequest readStored(MediaJob job) {
        try {
            return objectMapper.readValue(job.getRenderConfig(), UpdateRenderConfigRequest.class);
        } catch (JsonProcessingException ex) {
            log.error("corrupt render_config for job={}", job.getId(), ex);
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    private String write(UpdateRenderConfigRequest c) {
        try {
            return objectMapper.writeValueAsString(c);
        } catch (JsonProcessingException ex) {
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }
}
