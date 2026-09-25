package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.dto.pkg.OutputPackageResponse;
import com.app.modules.media_job.dto.pkg.PublishPackageResponse;
import com.app.modules.media_job.dto.pkg.UpdatePublishPackageRequest;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.service.MediaExportService;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.media_job.service.MediaPackageService;
import com.app.modules.media_job.util.StageOutputRefs;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class MediaPackageServiceImpl implements MediaPackageService {

    private static final Logger log = LoggerFactory.getLogger(MediaPackageServiceImpl.class);

    private final MediaJobService jobService;
    private final MediaExportService exportService;
    private final MediaJobRepository jobRepository;
    private final MediaAssetService assetService;
    private final MediaStorageService storage;
    private final ObjectMapper objectMapper;

    public MediaPackageServiceImpl(MediaJobService jobService, MediaExportService exportService,
                                   MediaJobRepository jobRepository, MediaAssetService assetService,
                                   MediaStorageService storage, ObjectMapper objectMapper) {
        this.jobService = jobService;
        this.exportService = exportService;
        this.jobRepository = jobRepository;
        this.assetService = assetService;
        this.storage = storage;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public OutputPackageResponse outputPackage(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = jobService.getJob(workspaceId, userId, jobId); // any role in the project may read
        List<MediaJobStage> stages = jobService.getStages(jobId);

        String videoRef = doneOutputRef(stages, MediaJobStage.StageName.RENDER);
        if (videoRef == null) {
            throw new AppException(ErrorCode.STAGE_NOT_READY);
        }

        // Tracks that were not produced (e.g. a job that keeps the original audio) are simply left out.
        List<OutputPackageResponse.AudioTrack> audio = new ArrayList<>();
        if (job.getTtsVoiceId() == null) {
            audio.add(new OutputPackageResponse.AudioTrack("ORIGINAL", null, null));
        }
        addAudioTrack(audio, "DUB", doneOutputRef(stages, MediaJobStage.StageName.TTS));
        addAudioTrack(audio, "MIX", doneOutputRef(stages, MediaJobStage.StageName.AUDIO_MIX));

        boolean hasSubtitles = !jobService.listSubtitles(workspaceId, userId, jobId).isEmpty();
        List<OutputPackageResponse.SubtitleTrack> subtitles = List.of(
                new OutputPackageResponse.SubtitleTrack("SRT", job.getTargetLang(), hasSubtitles),
                new OutputPackageResponse.SubtitleTrack("VTT", job.getTargetLang(), hasSubtitles));

        // ponytail: duration of the source asset (no rendered-asset row is recorded); checksum/pins are not tracked in mini
        Long durationMs = assetService.getAsset(workspaceId, userId, job.getRootAssetId()).getDurationMs();
        return new OutputPackageResponse(jobId, videoRef, signOrNull(videoRef), audio, subtitles, durationMs, null, List.of());
    }

    @Override
    @Transactional(readOnly = true)
    public PublishPackageResponse getPublishPackage(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = jobService.getJob(workspaceId, userId, jobId);
        return toResponse(job, read(job));
    }

    @Override
    @Transactional
    public PublishPackageResponse updatePublishPackage(UUID workspaceId, UUID userId, UUID jobId,
                                                       UpdatePublishPackageRequest request) {
        MediaJob job = jobRepository.findWithLockById(jobId)
                .filter(j -> j.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        jobService.requireJobOwnership(workspaceId, userId, job);
        exportService.requirePublishAllowed(workspaceId, userId, jobId);

        UpdatePublishPackageRequest merged = read(job).merge(request);
        try {
            job.setPublishPackage(objectMapper.writeValueAsString(merged));
        } catch (JsonProcessingException ex) {
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
        jobRepository.save(job);
        return toResponse(job, merged);
    }

    private PublishPackageResponse toResponse(MediaJob job, UpdatePublishPackageRequest d) {
        return new PublishPackageResponse("GENERIC", d.title(), d.description(),
                d.language() != null ? d.language() : job.getTargetLang(),
                d.tags() != null ? d.tags() : List.of(), d.thumbnailRef(), job.getId(), "DRAFT");
    }

    private UpdatePublishPackageRequest read(MediaJob job) {
        if (job.getPublishPackage() == null) {
            return new UpdatePublishPackageRequest(null, null, null, null, null);
        }
        try {
            return objectMapper.readValue(job.getPublishPackage(), UpdatePublishPackageRequest.class);
        } catch (JsonProcessingException ex) {
            log.error("corrupt publish_package for job={}", job.getId(), ex);
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    /** Output ref ({@code "<bucket>/<key>"}) of a COMPLETED stage, or null when the stage produced none. */
    private String doneOutputRef(List<MediaJobStage> stages, MediaJobStage.StageName name) {
        return stages.stream()
                .filter(s -> s.getStageName() == name && s.getStatus() == MediaJobStage.StageStatus.COMPLETED)
                .map(s -> StageOutputRefs.storageRef(s.getOutputRef()))
                .filter(r -> r != null && !r.isBlank())
                .findFirst().orElse(null);
    }

    private void addAudioTrack(List<OutputPackageResponse.AudioTrack> audio, String role, String ref) {
        if (ref != null) {
            audio.add(new OutputPackageResponse.AudioTrack(role, ref, signOrNull(ref)));
        }
    }

    /** Best effort: an unsignable ref must not break the whole preview. */
    private String signOrNull(String ref) {
        try {
            return storage.presignedGetUrl(ref);
        } catch (AppException ex) {
            log.warn("output-package: cannot sign ref={}: {}", ref, ex.getMessage());
            return null;
        }
    }
}
