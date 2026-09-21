package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_job.dto.style.SubtitleStylePreset;
import com.app.modules.media_job.dto.style.SubtitleStyleSnapshot;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.media_job.service.SubtitleStyleService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class SubtitleStyleServiceImpl implements SubtitleStyleService {

    private static final Pattern KEY_FORMAT = Pattern.compile("^[a-z0-9][a-z0-9-]{0,63}$");

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final WorkspaceAccessService access;
    private final MediaJobService jobService;
    private final ObjectMapper objectMapper;
    private final List<SubtitleStylePreset> catalog;

    public SubtitleStyleServiceImpl(MediaJobRepository jobRepository, MediaJobStageRepository stageRepository,
                                    WorkspaceAccessService access, MediaJobService jobService,
                                    ObjectMapper objectMapper) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.access = access;
        this.jobService = jobService;
        this.objectMapper = objectMapper;
        // ponytail: built-in catalog is a classpath JSON; move to a table if styles must be editable at runtime
        try (InputStream in = new ClassPathResource("subtitle-styles.json").getInputStream()) {
            this.catalog = List.copyOf(objectMapper.readValue(in, new TypeReference<List<SubtitleStylePreset>>() { }));
        } catch (IOException ex) {
            throw new IllegalStateException("Cannot load subtitle-styles.json", ex);
        }
    }

    @Override
    public List<SubtitleStylePreset> listPresets() {
        return catalog;
    }

    @Override
    public SubtitleStylePreset getPreset(String key) {
        if (key == null || !KEY_FORMAT.matcher(key).matches()) {
            throw new AppException(ErrorCode.INVALID_STYLE_KEY);
        }
        return catalog.stream().filter(p -> p.key().equals(key)).findFirst()
                .orElseThrow(() -> new AppException(ErrorCode.STYLE_NOT_FOUND));
    }

    @Override
    @Transactional(readOnly = true)
    public SubtitleStyleSnapshot currentStyle(UUID userId, UUID jobId) {
        MediaJob job = jobRepository.findById(jobId).orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        access.requireProjectAccess(job.getWorkspaceId(), userId, job.getProjectId());
        if (job.getSubtitleStyle() == null) {
            throw new AppException(ErrorCode.STYLE_NOT_FOUND);
        }
        return readSnapshot(job);
    }

    private SubtitleStyleSnapshot readSnapshot(MediaJob job) {
        if (job.getSubtitleStyle() == null) {
            return null;
        }
        try {
            return objectMapper.readValue(job.getSubtitleStyle(), SubtitleStyleSnapshot.class);
        } catch (JsonProcessingException ex) {
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    private String write(SubtitleStyleSnapshot snapshot) {
        try {
            return objectMapper.writeValueAsString(snapshot);
        } catch (JsonProcessingException ex) {
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    @Override
    @Transactional
    public SubtitleStyleSnapshot assignStyle(UUID userId, UUID jobId, String key) {
        SubtitleStylePreset preset = getPreset(key);
        MediaJob job = jobRepository.findWithLockById(jobId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        jobService.requireJobOwnership(job.getWorkspaceId(), userId, job);

        // compare parsed records: Postgres JSONB reorders keys, so raw string equality would never match
        if (!preset.snapshot().equals(readSnapshot(job))) { // same style again = no-op, nothing to re-render
            job.setSubtitleStyle(write(preset.snapshot()));
            jobRepository.save(job);
            stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER)
                    .filter(s -> s.getStatus() == MediaJobStage.StageStatus.COMPLETED)
                    .ifPresent(s -> {
                        s.setStatus(MediaJobStage.StageStatus.STALE);
                        stageRepository.save(s);
                    });
        }
        return preset.snapshot();
    }
}
