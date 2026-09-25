package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.service.CreditService;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_job.dto.BatchEditSegmentsRequest;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.dto.PatchSubtitleRequest;
import com.app.modules.media_job.dto.VoiceRequest;
import com.app.modules.media_job.dto.render.UpdateRenderConfigRequest;
import com.app.modules.media_job.dto.style.SubtitleStyleSnapshot;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.pipeline.MediaPipelineDispatcher;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.preset.service.PresetResolverService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.repository.QaIssueRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

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
    private final MediaPipelineDispatcher mediaPipelineDispatcher;
    private final QaIssueRepository qaIssueRepository;

    /** Deterministic timing checks recorded at TRANSLATE; re-evaluated (not auto-resolved) on edit. */
    private static final Set<String> TIMING_QA_TYPES = Set.of("subtitle_overlap", "invalid_timing");
    /** AI findings about timing/length also go stale when only the cue timing is edited. */
    private static final Set<String> TIMING_SENSITIVE_AI_TYPES = Set.of("timing", "length");

    // field-injected (not via constructor) so unit tests keep the default
    @Value("${app.media-job.max-batch-subtitle-updates:200}")
    private int maxBatchUpdates = 200;

    // ponytail: comma-separated ISO 639-1 codes; SRS has no supported-language list, so this default is ours to confirm
    @Value("${app.media-job.supported-source-langs:vi,en,zh,ja,ko,fr,de,es,th,id,ru}")
    private String supportedSourceLangs = "vi,en,zh,ja,ko,fr,de,es,th,id,ru";

    @Autowired
    public MediaJobServiceImpl(MediaJobRepository mediaJobRepository,
                                MediaJobStageRepository mediaJobStageRepository,
                                SubtitleSegmentRepository subtitleSegmentRepository,
                                WorkspaceAccessService access,
                                MediaAssetService mediaAssetService,
                                CreditService credit,
                                PresetResolverService presetResolver,
                                ProviderResolverService providerResolver,
                                NotificationService notification,
                                MediaPipelineDispatcher mediaPipelineDispatcher,
                                QaIssueRepository qaIssueRepository) {
        this.mediaJobRepository = mediaJobRepository;
        this.mediaJobStageRepository = mediaJobStageRepository;
        this.subtitleSegmentRepository = subtitleSegmentRepository;
        this.access = access;
        this.mediaAssetService = mediaAssetService;
        this.credit = credit;
        this.presetResolver = presetResolver;
        this.providerResolver = providerResolver;
        this.notification = notification;
        this.mediaPipelineDispatcher = mediaPipelineDispatcher;
        this.qaIssueRepository = qaIssueRepository;
    }

    /** Compatibility constructor for focused unit tests that do not exercise queue dispatch. */
    public MediaJobServiceImpl(MediaJobRepository mediaJobRepository,
                               MediaJobStageRepository mediaJobStageRepository,
                               SubtitleSegmentRepository subtitleSegmentRepository,
                               WorkspaceAccessService access,
                               MediaAssetService mediaAssetService,
                               CreditService credit,
                               PresetResolverService presetResolver,
                               ProviderResolverService providerResolver,
                               NotificationService notification) {
        this(mediaJobRepository, mediaJobStageRepository, subtitleSegmentRepository, access,
                mediaAssetService, credit, presetResolver, providerResolver, notification, null, null);
    }

    // ---- create ----

    @Override
    @Transactional
    public MediaJob createJob(UUID workspaceId, UUID userId, CreateMediaJobRequest req) {
        return createJobInternal(workspaceId, userId, req, null);
    }

    @Override
    @Transactional
    public MediaJob createBatchChildJob(UUID workspaceId, UUID userId, UUID batchId, CreateMediaJobRequest req) {
        return createJobInternal(workspaceId, userId, req, batchId);
    }

    @Override
    @Transactional(readOnly = true)
    public List<MediaJob> getJobsByBatch(UUID batchId) {
        return mediaJobRepository.findByBatchIdOrderByCreatedAtAsc(batchId);
    }

    private MediaJob createJobInternal(UUID workspaceId, UUID userId, CreateMediaJobRequest req, UUID batchId) {
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

        String canonicalRecipeId = canonicalizeRecipe(req.recipeId());
        boolean isLocalization = MediaJob.RECIPE_LOCALIZATION_FULL.equals(canonicalRecipeId);
        boolean isSummary = MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(canonicalRecipeId);
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

        // SOFT_SUB unless requested; a resolved preset may still choose it below.
        MediaJob.SubtitleMode subtitleMode = req.subtitleMode() != null
                ? parseEnum(MediaJob.SubtitleMode.class, req.subtitleMode()) : MediaJob.SubtitleMode.SOFT_SUB;
        MediaJob.OutputAudioMode outputAudioMode;
        if (req.outputAudioMode() != null) {
            outputAudioMode = parseEnum(MediaJob.OutputAudioMode.class, req.outputAudioMode());
        } else if (Boolean.TRUE.equals(req.keepOriginalAudio())) {
            outputAudioMode = MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        } else {
            outputAudioMode = MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        }
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
        if ((req.ttsProviderId() == null) != (req.ttsVoiceId() == null)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (req.ttsVoiceId() != null) {
            requireVoiceLanguageMatches(userId, req.ttsProviderId(), req.ttsVoiceId(), req.targetLang());
        }

        if (!credit.hasSufficientBalance(userId)) {
            throw new AppException(ErrorCode.INSUFFICIENT_CREDIT);
        }

        UUID resolvedPresetId = presetResolver.resolveForJobCreation(req.presetId(), req.projectId(), workspaceId);
        PresetResolverService.PresetJobConfig preset = resolvedPresetId == null
                ? null : presetResolver.findJobConfig(resolvedPresetId).orElse(null);
        UpdateRenderConfigRequest presetRender = PresetJobDefaults.renderConfig(preset);
        // explicit request field > preset > SOFT_SUB (API_Contract.md §9)
        if (req.subtitleMode() == null && presetRender.subtitleMode() != null) {
            subtitleMode = MediaJob.SubtitleMode.valueOf(presetRender.subtitleMode());
        }

        MediaJob job = new MediaJob();
        job.setWorkspaceId(workspaceId);
        job.setProjectId(req.projectId());
        job.setRootAssetId(req.rootAssetId());
        job.setBatchId(batchId);
        job.setRecipeId(canonicalRecipeId);
        if (req.sourceLang() != null && !req.sourceLang().isBlank()) {
            job.setSourceLanguage(req.sourceLang().trim());
        }
        job.setProcessingMode(processingMode);
        job.setTargetLang(req.targetLang());
        job.setRequestedDurationSeconds(req.requestedDurationSeconds());
        job.setSubtitleMode(subtitleMode);
        job.setOutputAudioMode(outputAudioMode);
        job.setSourceSeparationEnabled(sourceSeparationEnabled);
        job.setTtsProviderId(req.ttsProviderId());
        job.setTtsVoiceId(req.ttsVoiceId());
        job.setVisualContextEnabled(visualContextEnabled);
        job.setPresetId(resolvedPresetId);
        job.setPresetSnapshot(PresetJobDefaults.snapshot(preset));
        if (preset != null) {
            // the job's own subtitle mode wins over the preset's (it may come from the request)
            job.setRenderConfig(PresetJobDefaults.write(presetRender.merge(new UpdateRenderConfigRequest(
                    subtitleMode.name(), null, null, null, null, null, null, null))));
            SubtitleStyleSnapshot presetStyle = PresetJobDefaults.subtitleStyle(preset);
            if (presetStyle != null) {
                job.setSubtitleStyle(PresetJobDefaults.write(presetStyle));
            }
        }
        job.setWorkflowMode(workflowMode);
        job.setPerformedByUserId(userId);
        job.setCreatedByUserId(userId);
        job.setStatus(MediaJob.JobStatus.PENDING);
        job = mediaJobRepository.save(job);

        initializeStages(job);
        dispatchNextIfAvailable(job.getId());
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

    private void requireVoiceLanguageMatches(UUID userId, UUID ttsProviderId, UUID ttsVoiceId, String targetLang) {
        if (!providerResolver.isVoiceLanguageCompatible(userId, ttsProviderId, ttsVoiceId, targetLang)) {
            throw new AppException(ErrorCode.VOICE_LANGUAGE_MISMATCH);
        }
    }

    private String canonicalizeRecipe(String recipeId) {
        if ("summary.generative".equals(recipeId)) {
            return MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH;
        }
        return recipeId;
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
        if ("summary.generative".equals(recipeId)) {
            recipeId = MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH;
        }
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

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, List<MediaJobStage>> getStagesByJobIds(Collection<UUID> jobIds) {
        if (jobIds == null || jobIds.isEmpty()) {
            return Map.of();
        }
        return mediaJobStageRepository.findByMediaJobIdInOrderByStageOrder(jobIds).stream()
                .collect(Collectors.groupingBy(MediaJobStage::getMediaJobId));
    }

    // ---- cancel ----

    @Override
    @Transactional
    public MediaJob cancelJob(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        job = mediaJobRepository.findWithLockById(jobId).orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        if (job.getStatus() == MediaJob.JobStatus.PENDING || job.getStatus() == MediaJob.JobStatus.PROCESSING) {
            boolean waitingForWorker = false;

            // Mark active worker stages for graceful cancellation; the worker is signalled after commit.
            // Pending stages are cancelled immediately; PROCESSING stages wait for callback.
            for (MediaJobStage stage : mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)) {
                if (stage.getStatus() == MediaJobStage.StageStatus.PROCESSING) {
                    stage.setStatus(MediaJobStage.StageStatus.CANCEL_REQUESTED);
                    mediaJobStageRepository.save(stage);
                    waitingForWorker = true;
                } else if (stage.getStatus() == MediaJobStage.StageStatus.CANCEL_REQUESTED) {
                    waitingForWorker = true;
                } else if (stage.getStatus() == MediaJobStage.StageStatus.PENDING
                        || stage.getStatus() == MediaJobStage.StageStatus.STALE) {
                    stage.setStatus(MediaJobStage.StageStatus.CANCELLED);
                    mediaJobStageRepository.save(stage);
                }
            }
            job.setStatus(waitingForWorker ? MediaJob.JobStatus.PROCESSING : MediaJob.JobStatus.CANCELLED);
            job = mediaJobRepository.save(job);
            requestCancellationAfterCommit(jobId);
        }
        return job;
    }

    // ---- voice ----

    @Override
    @Transactional
    public MediaJob setVoice(UUID workspaceId, UUID userId, UUID jobId, UUID ttsProviderId, UUID ttsVoiceId) {
        return setVoice(workspaceId, userId, jobId, new VoiceRequest(ttsProviderId, ttsVoiceId));
    }

    @Override
    @Transactional
    public MediaJob setVoice(UUID workspaceId, UUID userId, UUID jobId, VoiceRequest request) {
        MediaJob job = requireJobInWorkspace(workspaceId, jobId);
        access.requireProjectWriteAccess(workspaceId, userId, job.getProjectId());
        job = mediaJobRepository.findWithLockById(jobId)
                .filter(locked -> workspaceId.equals(locked.getWorkspaceId()))
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        if (request == null || request.isDeselect()) {
            job.setOutputAudioMode(MediaJob.OutputAudioMode.ORIGINAL_ONLY);
            job.setTtsProviderId(null);
            job.setTtsVoiceId(null);
        } else {
            UUID resolvedProviderId;
            UUID resolvedVoiceId;
            if (request.isExplicitBinding()) {
                resolvedProviderId = request.ttsProviderId();
                resolvedVoiceId = request.ttsVoiceId();
                requireVoiceLanguageMatches(userId, resolvedProviderId, resolvedVoiceId, job.getTargetLang());
            } else if (request.hasLegacyVoiceId()) {
                ProviderResolverService.ResolvedVoice resolved = providerResolver
                        .resolveLegacyVoice(userId, request.voiceId(), job.getTargetLang());
                resolvedProviderId = resolved.providerId();
                resolvedVoiceId = resolved.voiceId();
            } else {
                throw new AppException(ErrorCode.VALIDATION_ERROR);
            }
            if (job.getOutputAudioMode() == MediaJob.OutputAudioMode.ORIGINAL_ONLY) {
                job.setOutputAudioMode(MediaJob.OutputAudioMode.DUB_REPLACE);
            }
            job.setTtsProviderId(resolvedProviderId);
            job.setTtsVoiceId(resolvedVoiceId);
        }
        return mediaJobRepository.save(job);
    }

    // ---- checkpoint ----

    @Override
    @Transactional
    public void confirmCheckpoint(UUID workspaceId, UUID userId, UUID jobId, Checkpoint checkpoint) {
        MediaJob job = mediaJobRepository.findWithLockById(jobId)
                .filter(locked -> workspaceId.equals(locked.getWorkspaceId()))
                .orElseGet(() -> requireJobInWorkspace(workspaceId, jobId));
        requireJobOwnership(workspaceId, userId, job);

        if (job.getWorkflowMode() != MediaJob.WorkflowMode.MANUAL) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        MediaJobStage stage = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, checkpoint.ownerStage())
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        stage.setInputRef("{\"checkpoint\":\"" + checkpoint.name() + "\",\"confirmedBy\":\"" + userId + "\"}");
        mediaJobStageRepository.save(stage);
        dispatchNextIfAvailable(jobId);
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
                stage.setErrorCode(null);
                stage.setErrorDetail(null);
                stage.setOutputRef(null);
                stage.setCompletedAt(null);
                mediaJobStageRepository.save(stage);
            }
        }

        // A summary rerun creates a new AI proposal round. Clear the previous
        // selection so MANUAL waits for a fresh choice and AUTO can select the
        // proposal produced by the rerun.
        if (stageName == MediaJobStage.StageName.SUMMARIZE
                && MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())
                && job.getSourceSummaryJobId() == null) {
            job.setSelectedProposalId(null);
        }

        job.setStatus(MediaJob.JobStatus.PENDING);
        job = mediaJobRepository.save(job);
        dispatchNextIfAvailable(jobId);
        return job;
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
        MediaJob job = lockJobForEdit(workspaceId, userId, jobId);
        SubtitleSegment segment = subtitleSegmentRepository.findByIdAndMediaJobId(segmentId, jobId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        EditChange change = changeOf(segment, request.targetText(), request.startMs(), request.endMs());
        applyEdit(segment, request.targetText(), request.startMs(), request.endMs());
        staleDownstreamStages(workspaceId, job);
        resolveQaAfterEdit(job, Map.of(segment.getId(), change));
        return segment;
    }

    @Override
    @Transactional
    public List<SubtitleSegment> batchUpdateSubtitles(UUID workspaceId, UUID userId, UUID jobId,
                                                       BatchEditSegmentsRequest request) {
        MediaJob job = lockJobForEdit(workspaceId, userId, jobId);

        List<BatchEditSegmentsRequest.Item> updates = request.updates();
        if (updates.size() > maxBatchUpdates) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        Set<UUID> ids = updates.stream().map(BatchEditSegmentsRequest.Item::segmentId).collect(Collectors.toSet());
        if (ids.size() != updates.size()) { // duplicate segmentId
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        Map<UUID, SubtitleSegment> byId = subtitleSegmentRepository.findByIdInAndMediaJobId(ids, jobId).stream()
                .collect(Collectors.toMap(SubtitleSegment::getId, Function.identity()));
        if (byId.size() != ids.size()) { // segment of another job / unknown
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        List<SubtitleSegment> result = new ArrayList<>(updates.size());
        Map<UUID, EditChange> changes = new HashMap<>();
        for (BatchEditSegmentsRequest.Item item : updates) {
            SubtitleSegment segment = byId.get(item.segmentId());
            changes.put(segment.getId(), changeOf(segment, item.targetText(), item.startMs(), item.endMs()));
            result.add(applyEdit(segment, item.targetText(), item.startMs(), item.endMs()));
        }
        staleDownstreamStages(workspaceId, job);
        resolveQaAfterEdit(job, changes);
        return result;
    }

    /** Locks the job row (FOR UPDATE) and enforces job ownership: LEAD any job, MEMBER own job, CLIENT denied. */
    private MediaJob lockJobForEdit(UUID workspaceId, UUID userId, UUID jobId) {
        MediaJob job = mediaJobRepository.findWithLockById(jobId)
                .filter(j -> j.getWorkspaceId().equals(workspaceId))
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        requireJobOwnership(workspaceId, userId, job);
        return job;
    }

    /** Null field = keep current value; validates the merged time range. */
    private SubtitleSegment applyEdit(SubtitleSegment segment, String targetText, Long startMs, Long endMs) {
        long start = startMs != null ? startMs : segment.getStartMs();
        long end = endMs != null ? endMs : segment.getEndMs();
        if (start < 0 || start >= end) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (targetText != null) {
            segment.setTargetText(targetText);
        }
        segment.setStartMs(start);
        segment.setEndMs(end);
        return subtitleSegmentRepository.save(segment);
    }

    private record EditChange(boolean text, boolean timing) {}

    private EditChange changeOf(SubtitleSegment segment, String targetText, Long startMs, Long endMs) {
        boolean text = targetText != null && !targetText.equals(segment.getTargetText());
        boolean timing = (startMs != null && startMs != segment.getStartMs())
                || (endMs != null && endMs != segment.getEndMs());
        return new EditChange(text, timing);
    }

    /**
     * Editing a cue is the fix path for its QA findings (SRS §5.3): AI findings about the edited
     * content are resolved, while deterministic timing issues are re-checked against the whole
     * timeline and resolved only when the cue no longer violates them. A RENDER held only by
     * these issues is released when nothing downstream became STALE (no surprise Credit spend).
     */
    private void resolveQaAfterEdit(MediaJob job, Map<UUID, EditChange> changes) {
        if (qaIssueRepository == null || changes.isEmpty()) {
            return;
        }
        List<SubtitleSegment> timeline = subtitleSegmentRepository.findByMediaJobIdOrderBySeq(job.getId());
        Set<UUID> timingViolations = new HashSet<>();
        for (int i = 0; i < timeline.size(); i++) {
            SubtitleSegment current = timeline.get(i);
            if (current.getEndMs() <= current.getStartMs()
                    || i > 0 && current.getStartMs() < timeline.get(i - 1).getEndMs()) {
                timingViolations.add(current.getId());
            }
        }
        List<UUID> ids = timeline.stream().map(SubtitleSegment::getId).toList();
        Instant now = Instant.now();
        boolean resolvedAny = false;
        for (QaIssue issue : qaIssueRepository.findBySubtitleSegmentIdInAndResolvedAtIsNull(ids)) {
            String type = issue.getIssueType() == null ? "" : issue.getIssueType().toLowerCase(Locale.ROOT);
            boolean resolve;
            if (TIMING_QA_TYPES.contains(type)) {
                // An edit elsewhere can fix an overlap, so every timing issue is re-checked.
                resolve = !timingViolations.contains(issue.getSubtitleSegmentId());
            } else {
                EditChange change = changes.get(issue.getSubtitleSegmentId());
                resolve = change != null
                        && (change.text() || change.timing() && TIMING_SENSITIVE_AI_TYPES.contains(type));
            }
            if (resolve) {
                issue.setResolvedAt(now);
                qaIssueRepository.save(issue);
                resolvedAny = true;
            }
        }
        boolean staleWork = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(job.getId()).stream()
                .anyMatch(stage -> stage.getStatus() == MediaJobStage.StageStatus.STALE);
        if (resolvedAny && !staleWork && mediaPipelineDispatcher != null) {
            mediaPipelineDispatcher.dispatchNext(job.getId());
        }
    }

    private void staleDownstreamStages(UUID workspaceId, MediaJob job) {
        UUID jobId = job.getId();
        // SRS §5.3 — editing subtitles after TTS/RENDER has produced output marks the
        // downstream stages STALE instead of silently re-running (avoids surprise Credit spend).
        List<MediaJobStage> stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        boolean pastTtsOrRender = stages.stream().anyMatch(s ->
                (s.getStageName() == MediaJobStage.StageName.TTS || s.getStageName() == MediaJobStage.StageName.RENDER)
                        && s.getStatus() == MediaJobStage.StageStatus.COMPLETED);
        if (pastTtsOrRender && markStale(stages, MediaJobStage.StageName.TTS)) {
            notification.notify(workspaceId, job.getCreatedByUserId(), "JOB_NEEDS_RERUN", jobId,
                    "Subtitle edited after TTS/RENDER — affected stages need a rerun");
        }
    }

    /** COMPLETED stages from {@code from} onward become STALE; true when at least one changed. */
    private boolean markStale(List<MediaJobStage> stages, MediaJobStage.StageName from) {
        boolean staled = false;
        for (MediaJobStage stage : stages) {
            if (stage.getStageOrder() >= from.order() && stage.getStatus() == MediaJobStage.StageStatus.COMPLETED) {
                stage.setStatus(MediaJobStage.StageStatus.STALE);
                mediaJobStageRepository.save(stage);
                staled = true;
            }
        }
        return staled;
    }

    @Override
    @Transactional
    public MediaJob overrideSourceLang(UUID workspaceId, UUID userId, UUID jobId, String sourceLang) {
        MediaJob job = lockJobForEdit(workspaceId, userId, jobId);

        String lang = sourceLang == null ? "" : sourceLang.trim().toLowerCase(Locale.ROOT);
        if (!Arrays.asList(supportedSourceLangs.toLowerCase(Locale.ROOT).split("\\s*,\\s*")).contains(lang)
                || lang.equals(primaryLang(job.getTargetLang()))) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }

        // Only a settled job after STT: no zombie revival of FAILED/CANCELLED, no rewind while a stage is in flight.
        List<MediaJobStage> stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        boolean sttDone = stages.stream().anyMatch(s ->
                s.getStageName() == MediaJobStage.StageName.STT && s.getStatus() == MediaJobStage.StageStatus.COMPLETED);
        boolean inFlight = stages.stream().anyMatch(s ->
                s.getStatus() == MediaJobStage.StageStatus.PROCESSING
                        || s.getStatus() == MediaJobStage.StageStatus.CANCEL_REQUESTED);
        if (!sttDone || inFlight || job.getStatus() == MediaJob.JobStatus.FAILED
                || job.getStatus() == MediaJob.JobStatus.CANCELLED) {
            throw new AppException(ErrorCode.STAGE_NOT_READY);
        }

        if (!lang.equals(job.getSourceLanguage())) { // same language again = no-op
            job.setSourceLanguage(lang);
            mediaJobRepository.save(job);
            // STT output is language-independent, so only TRANSLATE onward is stale; never auto-rerun (Credit spend).
            if (markStale(stages, MediaJobStage.StageName.TRANSLATE)) {
                notification.notify(workspaceId, job.getCreatedByUserId(), "JOB_NEEDS_RERUN", jobId,
                        "Source language changed — TRANSLATE and later stages need a rerun");
            }
        }
        return job;
    }

    private static String primaryLang(String code) {
        return code == null ? "" : code.toLowerCase(Locale.ROOT).split("[-_]")[0];
    }

    private MediaJob requireJobInWorkspace(UUID workspaceId, UUID jobId) {
        return mediaJobRepository.findByIdAndWorkspaceId(jobId, workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<SubtitleSegment> findSubtitleSegmentById(UUID segmentId) {
        return subtitleSegmentRepository.findById(segmentId);
    }

    // ---- summarization support (§2.3) ----

    @Override
    @Transactional
    public MediaJob updateSelectedProposal(UUID workspaceId, UUID userId, UUID jobId, UUID proposalId) {
        MediaJob job = mediaJobRepository.findWithLockById(jobId)
                .filter(locked -> workspaceId.equals(locked.getWorkspaceId()))
                .orElseGet(() -> requireJobInWorkspace(workspaceId, jobId));
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
    public MediaJob createDerivedSummaryJob(UUID workspaceId, UUID userId, UUID sourceJobId, String targetLang,
                                            UUID ttsProviderId, UUID ttsVoiceId) {
        MediaJob source = requireJobInWorkspace(workspaceId, sourceJobId);
        access.requireProjectWriteAccess(workspaceId, userId, source.getProjectId());

        if ((ttsProviderId == null) != (ttsVoiceId == null)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        MediaJob.OutputAudioMode outputAudioMode = ttsVoiceId != null
                ? MediaJob.OutputAudioMode.DUB_REPLACE : MediaJob.OutputAudioMode.ORIGINAL_ONLY;
        if (ttsVoiceId != null) {
            requireVoiceLanguageMatches(userId, ttsProviderId, ttsVoiceId, targetLang);
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
        job.setTtsProviderId(ttsProviderId);
        job.setTtsVoiceId(ttsVoiceId);
        job.setVisualContextEnabled(false);
        job.setPresetId(source.getPresetId());
        job.setPresetSnapshot(source.getPresetSnapshot());
        // a derived language keeps the source job's frame and subtitle look
        job.setRenderConfig(source.getRenderConfig());
        job.setSubtitleStyle(source.getSubtitleStyle());
        job.setWorkflowMode(source.getWorkflowMode());
        job.setPerformedByUserId(userId);
        job.setCreatedByUserId(userId);
        job.setStatus(MediaJob.JobStatus.PENDING);
        job = mediaJobRepository.save(job);

        initializeStages(job);
        dispatchNextIfAvailable(job.getId());
        return job;
    }

    private void dispatchNextIfAvailable(UUID jobId) {
        if (mediaPipelineDispatcher != null) {
            mediaPipelineDispatcher.dispatchNext(jobId);
        }
    }

    private void requestCancellationAfterCommit(UUID jobId) {
        if (mediaPipelineDispatcher != null) {
            mediaPipelineDispatcher.requestCancellationAfterCommit(jobId);
        }
    }
}
