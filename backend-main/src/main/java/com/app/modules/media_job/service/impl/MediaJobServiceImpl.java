package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.service.CreditService;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.preset.service.PresetResolverService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class MediaJobServiceImpl implements MediaJobService {

    private final MediaJobRepository mediaJobRepository;
    private final MediaJobStageRepository mediaJobStageRepository;
    private final SubtitleSegmentRepository subtitleSegmentRepository;
    private final WorkspaceAccessService access;
    private final MediaAssetService mediaAssetService;
    private final CreditService credit;
    private final PresetResolverService presetResolver;
    private final ProviderResolverService providerResolver;
    private final NotificationService notification;

    public MediaJobServiceImpl(MediaJobRepository mediaJobRepository,
                                MediaJobStageRepository mediaJobStageRepository,
                                SubtitleSegmentRepository subtitleSegmentRepository,
                                WorkspaceAccessService access,
                                MediaAssetService mediaAssetService,
                                CreditService credit,
                                PresetResolverService presetResolver,
                                ProviderResolverService providerResolver,
                                NotificationService notification) {
        this.mediaJobRepository = mediaJobRepository;
        this.mediaJobStageRepository = mediaJobStageRepository;
        this.subtitleSegmentRepository = subtitleSegmentRepository;
        this.access = access;
        this.mediaAssetService = mediaAssetService;
        this.credit = credit;
        this.presetResolver = presetResolver;
        this.providerResolver = providerResolver;
        this.notification = notification;
    }

    // ---- create ----

    @Override
    @Transactional
    public MediaJob createJob(UUID workspaceId, UUID userId, CreateMediaJobRequest req) {
        access.requireProjectWriteAccess(workspaceId, userId, req.projectId());

        MediaAsset rootAsset = mediaAssetService.getAsset(workspaceId, userId, req.rootAssetId());
        if (rootAsset.getParentAssetId() != null
                || rootAsset.getAssetType() != MediaAsset.AssetType.SOURCE_VIDEO
                || !rootAsset.getProjectId().equals(req.projectId())) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (!mediaAssetService.hasCurrentConsent(req.rootAssetId())) {
            throw new AppException(ErrorCode.TERMS_NOT_ACCEPTED);
        }

        boolean isLocalization = MediaJob.RECIPE_LOCALIZATION_FULL.equals(req.recipeId());
        boolean isSummary = MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(req.recipeId());
        if (!isLocalization && !isSummary) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        // ck_job_recipe_mode
        MediaJob.ProcessingMode processingMode = parseEnum(MediaJob.ProcessingMode.class, req.processingMode());
        if (isLocalization && processingMode == null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (isSummary && (processingMode != null
                || req.requestedDurationSeconds() == null || req.requestedDurationSeconds() <= 0)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        MediaJob.SubtitleMode subtitleMode = req.subtitleMode() != null
                ? parseEnum(MediaJob.SubtitleMode.class, req.subtitleMode()) : MediaJob.SubtitleMode.SOFT_SUB;
        MediaJob.OutputAudioMode outputAudioMode = req.outputAudioMode() != null
                ? parseEnum(MediaJob.OutputAudioMode.class, req.outputAudioMode()) : MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        MediaJob.WorkflowMode workflowMode = req.workflowMode() != null
                ? parseEnum(MediaJob.WorkflowMode.class, req.workflowMode()) : MediaJob.WorkflowMode.MANUAL;
        if (subtitleMode == null || outputAudioMode == null || workflowMode == null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        boolean sourceSeparationEnabled = Boolean.TRUE.equals(req.sourceSeparationEnabled());
        boolean visualContextEnabled = Boolean.TRUE.equals(req.visualContextEnabled());

        // ck_audio_mode_sep
        if (outputAudioMode == MediaJob.OutputAudioMode.DUB_MIX && !sourceSeparationEnabled) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        // ck_audio_mode_voice
        boolean voiceRequired = outputAudioMode != MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        if (voiceRequired != (req.ttsVoiceId() != null)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (req.ttsVoiceId() != null) {
            requireVoiceLanguageMatches(req.ttsVoiceId(), req.targetLang());
        }

        if (!credit.hasSufficientBalance(userId)) {
            throw new AppException(ErrorCode.INSUFFICIENT_CREDIT);
        }

        UUID resolvedPresetId = presetResolver.resolveForJobCreation(req.presetId(), req.projectId(), workspaceId);

        MediaJob job = new MediaJob();
        job.setWorkspaceId(workspaceId);
        job.setProjectId(req.projectId());
        job.setRootAssetId(req.rootAssetId());
        job.setRecipeId(req.recipeId());
        job.setProcessingMode(processingMode);
        job.setTargetLang(req.targetLang());
        job.setRequestedDurationSeconds(req.requestedDurationSeconds());
        job.setSubtitleMode(subtitleMode);
        job.setOutputAudioMode(outputAudioMode);
        job.setSourceSeparationEnabled(sourceSeparationEnabled);
        job.setTtsVoiceId(req.ttsVoiceId());
        job.setVisualContextEnabled(visualContextEnabled);
        job.setPresetId(resolvedPresetId);
        job.setPresetSnapshot(resolvedPresetId != null ? "{\"presetId\":\"" + resolvedPresetId + "\"}" : "{}");
        job.setWorkflowMode(workflowMode);
        job.setPerformedByUserId(userId);
        job.setCreatedByUserId(userId);
        job.setStatus(MediaJob.JobStatus.PENDING);
        job = mediaJobRepository.save(job);

        initializeStages(job);
        return job;
    }

    private void initializeStages(MediaJob job) {
        boolean summarize = (MediaJob.RECIPE_LOCALIZATION_FULL.equals(job.getRecipeId())
                && job.getProcessingMode() == MediaJob.ProcessingMode.HYBRID)
                || (MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId()) && job.getSourceSummaryJobId() == null);
        boolean tts = job.getOutputAudioMode() != MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        boolean audioMix = job.getOutputAudioMode() == MediaJob.OutputAudioMode.DUB_MIX;

        for (MediaJobStage.StageName name : MediaJobStage.StageName.values()) {
            MediaJobStage stage = new MediaJobStage();
            stage.setMediaJobId(job.getId());
            stage.setStageName(name);
            stage.setStageOrder(name.order());
            stage.setStatus(isSkippedByDefault(name, job, summarize, tts, audioMix)
                    ? MediaJobStage.StageStatus.SKIPPED : MediaJobStage.StageStatus.PENDING);
            mediaJobStageRepository.save(stage);
        }
    }

    // Database_Design.md §6.3 activation note.
    private boolean isSkippedByDefault(MediaJobStage.StageName name, MediaJob job,
                                        boolean summarize, boolean tts, boolean audioMix) {
        if (job.getSourceSummaryJobId() != null) {
            // Arch §7.7 "summary-languages" derived job — only TRANSLATE(script) -> TTS(optional) -> RENDER run.
            return switch (name) {
                case TRANSLATE, RENDER -> false;
                case TTS -> !tts;
                default -> true;
            };
        }
        return switch (name) {
            case SOURCE_SEPARATION -> !job.isSourceSeparationEnabled();
            case SUMMARIZE -> !summarize;
            case TTS -> !tts;
            case AUDIO_MIX -> !audioMix;
            default -> false;
        };
    }

    private void requireVoiceLanguageMatches(UUID ttsVoiceId, String targetLang) {
        String voiceLang = providerResolver.resolveVoiceLanguage(ttsVoiceId)
                .orElseThrow(() -> new AppException(ErrorCode.VALIDATION_ERROR));
        if (!voiceLang.equalsIgnoreCase(targetLang)) {
            throw new AppException(ErrorCode.VOICE_LANGUAGE_MISMATCH);
        }
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String value) {
        if (value == null) {
            return null;
        }
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException e) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
    }

    // ---- read ----

    @Override
    @Transactional(readOnly = true)
    public List<MediaJob> listJobs(UUID workspaceId, UUID userId, UUID projectId,
                                    MediaJob.JobStatus status, String recipeId) {
        access.requireProjectAccess(workspaceId, userId, projectId);
        if (status != null && recipeId != null) {
            return mediaJobRepository.findByWorkspaceIdAndProjectIdAndStatusAndRecipeId(workspaceId, projectId, status, recipeId);
        }
        if (status != null) {
            return mediaJobRepository.findByWorkspaceIdAndProjectIdAndStatus(workspaceId, projectId, status);
        }
        if (recipeId != null) {
            return mediaJobRepository.findByWorkspaceIdAndProjectIdAndRecipeId(workspaceId, projectId, recipeId);
        }
        return mediaJobRepository.findByWorkspaceIdAndProjectId(workspaceId, projectId);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaJob getJob(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectAccess(workspaceId, userId, job.getProjectId());
        return job;
    }

    @Override
    @Transactional(readOnly = true)
    public List<MediaJobStage> getStages(UUID jobId) {
        return mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
    }

    // ---- cancel ----

    @Override
    @Transactional
    public MediaJob cancelJob(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        job = mediaJobRepository.findWithLockById(jobId).orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        if (job.getStatus() == MediaJob.JobStatus.PENDING || job.getStatus() == MediaJob.JobStatus.PROCESSING) {
            job.setStatus(MediaJob.JobStatus.CANCELLED);
            job = mediaJobRepository.save(job);

            // ponytail: no worker/queue dispatch wired up yet in this iteration, so stages go
            // straight to CANCELLED instead of CANCEL_REQUESTED -> add the ack round-trip once
            // the RabbitMQ cancel signal (Arch §1 mục 4) is implemented.
            for (MediaJobStage stage : mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)) {
                if (stage.getStatus() == MediaJobStage.StageStatus.PENDING
                        || stage.getStatus() == MediaJobStage.StageStatus.PROCESSING) {
                    stage.setStatus(MediaJobStage.StageStatus.CANCELLED);
                    mediaJobStageRepository.save(stage);
                }
            }
        }
        return job;
    }

    // ---- voice ----

    @Override
    @Transactional
    public MediaJob setVoice(UUID workspaceId, UUID userId, UUID jobId, UUID ttsVoiceId) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());

        if (ttsVoiceId == null) {
            if (job.getOutputAudioMode() != MediaJob.OutputAudioMode.ORIGINAL_ONLY) {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            job.setTtsVoiceId(null);
        } else {
            requireVoiceLanguageMatches(ttsVoiceId, job.getTargetLang());
            job.setTtsVoiceId(ttsVoiceId);
        }
        return mediaJobRepository.save(job);
    }

    // ---- checkpoint ----

    @Override
    @Transactional
    public void confirmCheckpoint(UUID workspaceId, UUID userId, UUID jobId, Checkpoint checkpoint) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        requireJobOwnership(workspaceId, userId, job);

        if (job.getWorkflowMode() != MediaJob.WorkflowMode.MANUAL) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        MediaJobStage stage = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, checkpoint.ownerStage())
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        stage.setInputRef("{\"checkpoint\":\"" + checkpoint.name() + "\",\"confirmedBy\":\"" + userId + "\"}");
        mediaJobStageRepository.save(stage);
    }

    @Override
    public void requireJobOwnership(UUID workspaceId, UUID userId, MediaJob job) {
        access.requireProjectAccess(workspaceId, userId, job.getProjectId());
        Role role = access.getRole(workspaceId, userId);
        if (role == Role.LEAD) {
            return;
        }
        if (role == Role.MEMBER && job.getCreatedByUserId().equals(userId)) {
            return;
        }
        throw new AppException(ErrorCode.JOB_OWNERSHIP_REQUIRED);
    }

    // ---- rerun-from-stage ----

    @Override
    @Transactional
    public MediaJob rerunFromStage(UUID workspaceId, UUID userId, UUID jobId, MediaJobStage.StageName stageName) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        job = mediaJobRepository.findWithLockById(jobId).orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        List<MediaJobStage> stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        MediaJobStage target = stages.stream().filter(s -> s.getStageName() == stageName).findFirst()
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        for (MediaJobStage stage : stages) {
            if (stage.getStageOrder() < target.getStageOrder()
                    && stage.getStatus() != MediaJobStage.StageStatus.COMPLETED
                    && stage.getStatus() != MediaJobStage.StageStatus.SKIPPED) {
                throw new AppException(ErrorCode.STAGE_NOT_READY);
            }
        }

        for (MediaJobStage stage : stages) {
            if (stage.getStageOrder() >= target.getStageOrder() && stage.getStatus() != MediaJobStage.StageStatus.SKIPPED) {
                stage.setStatus(MediaJobStage.StageStatus.PENDING);
                stage.setProgressPercent((short) 0);
                stage.setErrorMessage(null);
                stage.setOutputRef(null);
                stage.setCompletedAt(null);
                mediaJobStageRepository.save(stage);
            }
        }

        job.setStatus(MediaJob.JobStatus.PENDING);
        return mediaJobRepository.save(job);
    }

    // ---- subtitles ----

    @Override
    @Transactional(readOnly = true)
    public List<SubtitleSegment> listSubtitles(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectAccess(workspaceId, userId, job.getProjectId());
        return subtitleSegmentRepository.findByMediaJobIdOrderBySeq(jobId);
    }

    @Override
    @Transactional
    public SubtitleSegment patchSubtitle(UUID workspaceId, UUID userId, UUID jobId, UUID segmentId,
                                          PatchSubtitleRequest request) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        SubtitleSegment segment = subtitleSegmentRepository.findByIdAndMediaJobId(segmentId, jobId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        if (request.targetText() != null) {
            segment.setTargetText(request.targetText());
        }
        if (request.startMs() != null) {
            segment.setStartMs(request.startMs());
        }
        if (request.endMs() != null) {
            segment.setEndMs(request.endMs());
        }
        segment = subtitleSegmentRepository.save(segment);

        // SRS §5.3 — editing subtitles after TTS/RENDER has produced output marks the
        // downstream stages STALE instead of silently re-running (avoids surprise Credit spend).
        List<MediaJobStage> stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        boolean pastTtsOrRender = stages.stream().anyMatch(s ->
                (s.getStageName() == MediaJobStage.StageName.TTS || s.getStageName() == MediaJobStage.StageName.RENDER)
                        && s.getStatus() == MediaJobStage.StageStatus.COMPLETED);
        if (pastTtsOrRender) {
            boolean staled = false;
            for (MediaJobStage stage : stages) {
                if (stage.getStageOrder() >= MediaJobStage.StageName.TTS.order()
                        && stage.getStatus() == MediaJobStage.StageStatus.COMPLETED) {
                    stage.setStatus(MediaJobStage.StageStatus.STALE);
                    mediaJobStageRepository.save(stage);
                    staled = true;
                }
            }
            if (staled) {
                notification.notify(workspaceId, job.getCreatedByUserId(), "JOB_NEEDS_RERUN", jobId,
                        "Subtitle edited after TTS/RENDER — affected stages need a rerun");
            }
        }
        return segment;
    }

    private MediaJob requireJobInWorkspace(UUID workspaceId, UUID jobId) {
        return mediaJobRepository.findByIdAndWorkspaceId(jobId, workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
    }

    // ---- summarization support (§2.3) ----

    @Override
    @Transactional
    public MediaJob updateSelectedProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());

        if (proposalId.equals(job.getSelectedProposalId())) {
            return job;
        }
        boolean alreadyTranslated = job.getSelectedProposalId() != null
                && mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.TRANSLATE)
                        .map(s -> s.getStatus() == MediaJobStage.StageStatus.COMPLETED)
                        .orElse(false);
        if (alreadyTranslated) {
            throw new AppException(ErrorCode.PROPOSAL_ALREADY_TRANSLATED);
        }
        job.setSelectedProposalId(proposalId);
        return mediaJobRepository.save(job);
    }

    @Override
    @Transactional
    public MediaJob createDerivedSummaryJob(UUID workspaceId, UUID userId, UUID sourceJobId, String targetLang, UUID ttsVoiceId) {
        MediaJob source = requireJobInWorkspace(workspaceId, sourceJobId);
        access.requireProjectWriteAccess(workspaceId, userId, source.getProjectId());

        MediaJob.OutputAudioMode outputAudioMode = ttsVoiceId != null
                ? MediaJob.OutputAudioMode.DUB_REPLACE : MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        if (ttsVoiceId != null) {
            requireVoiceLanguageMatches(ttsVoiceId, targetLang);
        }
        if (!credit.hasSufficientBalance(userId)) {
            throw new AppException(ErrorCode.INSUFFICIENT_CREDIT);
        }

        MediaJob job = new MediaJob();
        job.setWorkspaceId(workspaceId);
        job.setProjectId(source.getProjectId());
        job.setRootAssetId(source.getRootAssetId());
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setTargetLang(targetLang);
        job.setRequestedDurationSeconds(source.getRequestedDurationSeconds());
        job.setSourceSummaryJobId(source.getId());
        job.setSelectedProposalId(source.getSelectedProposalId());
        job.setSubtitleMode(source.getSubtitleMode());
        job.setOutputAudioMode(outputAudioMode);
        job.setTtsVoiceId(ttsVoiceId);
        job.setVisualContextEnabled(false);
        job.setPresetId(source.getPresetId());
        job.setPresetSnapshot(source.getPresetSnapshot());
        job.setWorkflowMode(source.getWorkflowMode());
        job.setPerformedByUserId(userId);
        job.setCreatedByUserId(userId);
        job.setStatus(MediaJob.JobStatus.PENDING);
        job = mediaJobRepository.save(job);

        initializeStages(job);
        return job;
    }
}
