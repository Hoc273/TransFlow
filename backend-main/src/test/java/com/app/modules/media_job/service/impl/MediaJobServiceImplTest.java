package com.app.modules.media_job.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.credit.service.CreditService;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_job.dto.CreateMediaJobRequest;
import com.app.modules.media_job.entity.Checkpoint;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.preset.service.PresetResolverService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MediaJobServiceImplTest {

    @Mock private MediaJobRepository mediaJobRepository;
    @Mock private MediaJobStageRepository mediaJobStageRepository;
    @Mock private SubtitleSegmentRepository subtitleSegmentRepository;
    @Mock private WorkspaceAccessService access;
    @Mock private MediaAssetService mediaAssetService;
    @Mock private CreditService credit;
    @Mock private PresetResolverService presetResolver;
    @Mock private ProviderResolverService providerResolver;
    @Mock private NotificationService notification;

    private MediaJobServiceImpl service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID rootAssetId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new MediaJobServiceImpl(mediaJobRepository, mediaJobStageRepository, subtitleSegmentRepository,
                access, mediaAssetService, credit, presetResolver, providerResolver, notification);
    }

    private MediaAsset rootVideoAsset() {
        MediaAsset asset = new MediaAsset();
        asset.setProjectId(projectId);
        asset.setParentAssetId(null);
        asset.setAssetType(MediaAsset.AssetType.SOURCE_VIDEO);
        return asset;
    }

    private CreateMediaJobRequest localizationRequest(String outputAudioMode, boolean sourceSeparation, UUID voiceId) {
        return new CreateMediaJobRequest(projectId, rootAssetId, MediaJob.RECIPE_LOCALIZATION_FULL,
                "TRANSLATE_ONLY", "en", null, null, outputAudioMode, sourceSeparation, voiceId, null, null, null);
    }

    private void stubHappyPathUpToCreditCheck() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(true);
        when(credit.hasSufficientBalance(userId)).thenReturn(true);
        when(presetResolver.resolveForJobCreation(any(), any(), any())).thenReturn(null);
        when(mediaJobRepository.save(any(MediaJob.class))).thenAnswer(inv -> {
            MediaJob j = inv.getArgument(0);
            if (j.getId() == null) {
                j.setId(UUID.randomUUID());
            }
            return j;
        });
    }

    // ---- createJob ----

    @Test
    void createJob_translateOnly_initializesEightStagesWithCorrectSkips() {
        stubHappyPathUpToCreditCheck();

        MediaJob job = service.createJob(workspaceId, userId, localizationRequest("ORIGINAL_ONLY", false, null));

        verify(access).requireProjectWriteAccess(workspaceId, userId, projectId);
        assertEquals(userId, job.getCreatedByUserId());
        assertEquals(userId, job.getPerformedByUserId());
        assertEquals(MediaJob.JobStatus.PENDING, job.getStatus());

        var captor = org.mockito.ArgumentCaptor.forClass(MediaJobStage.class);
        verify(mediaJobStageRepository, times(8)).save(captor.capture());
        var byName = captor.getAllValues().stream()
                .collect(java.util.stream.Collectors.toMap(MediaJobStage::getStageName, s -> s));

        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.EXTRACT_AUDIO).getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, byName.get(MediaJobStage.StageName.SOURCE_SEPARATION).getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.STT).getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, byName.get(MediaJobStage.StageName.SUMMARIZE).getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.TRANSLATE).getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, byName.get(MediaJobStage.StageName.TTS).getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, byName.get(MediaJobStage.StageName.AUDIO_MIX).getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.RENDER).getStatus());
    }

    @Test
    void createJob_hybridProcessingMode_activatesSummarizeStage() {
        stubHappyPathUpToCreditCheck();
        CreateMediaJobRequest req = new CreateMediaJobRequest(projectId, rootAssetId, MediaJob.RECIPE_LOCALIZATION_FULL,
                "HYBRID", "en", null, null, "ORIGINAL_ONLY", false, null, null, null, null);

        service.createJob(workspaceId, userId, req);

        var captor = org.mockito.ArgumentCaptor.forClass(MediaJobStage.class);
        verify(mediaJobStageRepository, times(8)).save(captor.capture());
        var summarize = captor.getAllValues().stream()
                .filter(s -> s.getStageName() == MediaJobStage.StageName.SUMMARIZE).findFirst().orElseThrow();
        assertEquals(MediaJobStage.StageStatus.PENDING, summarize.getStatus());
    }

    @Test
    void createJob_dubMixWithSourceSeparation_activatesTtsAndAudioMix() {
        stubHappyPathUpToCreditCheck();
        UUID voiceId = UUID.randomUUID();
        when(providerResolver.resolveVoiceLanguage(voiceId)).thenReturn(Optional.of("en"));

        service.createJob(workspaceId, userId, localizationRequest("DUB_MIX", true, voiceId));

        var captor = org.mockito.ArgumentCaptor.forClass(MediaJobStage.class);
        verify(mediaJobStageRepository, times(8)).save(captor.capture());
        var byName = captor.getAllValues().stream()
                .collect(java.util.stream.Collectors.toMap(MediaJobStage::getStageName, s -> s));
        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.TTS).getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.AUDIO_MIX).getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, byName.get(MediaJobStage.StageName.SOURCE_SEPARATION).getStatus());
    }

    @Test
    void createJob_derivedAsset_throwsValidationError() {
        MediaAsset derived = rootVideoAsset();
        derived.setParentAssetId(UUID.randomUUID());
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(derived);

        AppException ex = assertThrows(AppException.class, () ->
                service.createJob(workspaceId, userId, localizationRequest("ORIGINAL_ONLY", false, null)));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verifyNoInteractions(credit, mediaJobRepository);
    }

    @Test
    void createJob_noConsent_throwsTermsNotAccepted() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () ->
                service.createJob(workspaceId, userId, localizationRequest("ORIGINAL_ONLY", false, null)));
        assertEquals(ErrorCode.TERMS_NOT_ACCEPTED, ex.getErrorCode());
    }

    @Test
    void createJob_dubMixWithoutSourceSeparation_throwsValidationError() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(true);
        UUID voiceId = UUID.randomUUID();

        AppException ex = assertThrows(AppException.class, () ->
                service.createJob(workspaceId, userId, localizationRequest("DUB_MIX", false, voiceId)));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void createJob_voiceRequiredButMissing_throwsValidationError() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(true);

        AppException ex = assertThrows(AppException.class, () ->
                service.createJob(workspaceId, userId, localizationRequest("DUB_REPLACE", false, null)));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void createJob_voiceLanguageMismatch_throwsVoiceLanguageMismatch() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(true);
        UUID voiceId = UUID.randomUUID();
        when(providerResolver.resolveVoiceLanguage(voiceId)).thenReturn(Optional.of("fr"));

        AppException ex = assertThrows(AppException.class, () ->
                service.createJob(workspaceId, userId, localizationRequest("DUB_REPLACE", false, voiceId)));
        assertEquals(ErrorCode.VOICE_LANGUAGE_MISMATCH, ex.getErrorCode());
    }

    @Test
    void createJob_insufficientCredit_throwsInsufficientCredit() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(true);
        when(credit.hasSufficientBalance(userId)).thenReturn(false);

        AppException ex = assertThrows(AppException.class, () ->
                service.createJob(workspaceId, userId, localizationRequest("ORIGINAL_ONLY", false, null)));
        assertEquals(ErrorCode.INSUFFICIENT_CREDIT, ex.getErrorCode());
        verify(mediaJobRepository, never()).save(any());
    }

    @Test
    void createJob_summaryRecipeMissingDuration_throwsValidationError() {
        when(mediaAssetService.getAsset(workspaceId, userId, rootAssetId)).thenReturn(rootVideoAsset());
        when(mediaAssetService.hasCurrentConsent(rootAssetId)).thenReturn(true);
        CreateMediaJobRequest req = new CreateMediaJobRequest(projectId, rootAssetId, MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH,
                null, "vi", null, null, "ORIGINAL_ONLY", false, null, null, null, null);

        AppException ex = assertThrows(AppException.class, () -> service.createJob(workspaceId, userId, req));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    // ---- requireJobOwnership ----

    @Test
    void requireJobOwnership_lead_isAllowedOnAnyJob() {
        MediaJob job = new MediaJob();
        job.setProjectId(projectId);
        job.setCreatedByUserId(UUID.randomUUID());
        when(access.getRole(workspaceId, userId)).thenReturn(Role.LEAD);

        assertDoesNotThrow(() -> service.requireJobOwnership(workspaceId, userId, job));
    }

    @Test
    void requireJobOwnership_memberOwnJob_isAllowed() {
        MediaJob job = new MediaJob();
        job.setProjectId(projectId);
        job.setCreatedByUserId(userId);
        when(access.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);

        assertDoesNotThrow(() -> service.requireJobOwnership(workspaceId, userId, job));
    }

    @Test
    void requireJobOwnership_memberOtherUsersJob_throwsJobOwnershipRequired() {
        MediaJob job = new MediaJob();
        job.setProjectId(projectId);
        job.setCreatedByUserId(UUID.randomUUID());
        when(access.getRole(workspaceId, userId)).thenReturn(Role.MEMBER);

        AppException ex = assertThrows(AppException.class, () -> service.requireJobOwnership(workspaceId, userId, job));
        assertEquals(ErrorCode.JOB_OWNERSHIP_REQUIRED, ex.getErrorCode());
    }

    @Test
    void requireJobOwnership_client_throwsJobOwnershipRequired() {
        MediaJob job = new MediaJob();
        job.setProjectId(projectId);
        job.setCreatedByUserId(userId);
        when(access.getRole(workspaceId, userId)).thenReturn(Role.CLIENT);

        AppException ex = assertThrows(AppException.class, () -> service.requireJobOwnership(workspaceId, userId, job));
        assertEquals(ErrorCode.JOB_OWNERSHIP_REQUIRED, ex.getErrorCode());
    }

    @Test
    void requireJobOwnership_noProjectAccess_propagatesUnauthorized() {
        MediaJob job = new MediaJob();
        job.setProjectId(projectId);
        job.setCreatedByUserId(userId);
        doThrow(new AppException(ErrorCode.UNAUTHORIZED)).when(access).requireProjectAccess(workspaceId, userId, projectId);

        AppException ex = assertThrows(AppException.class, () -> service.requireJobOwnership(workspaceId, userId, job));
        assertEquals(ErrorCode.UNAUTHORIZED, ex.getErrorCode());
        verify(access, never()).getRole(any(), any());
    }

    // ---- rerunFromStage ----

    private MediaJob existingJob(UUID jobId) {
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(workspaceId);
        job.setProjectId(projectId);
        job.setStatus(MediaJob.JobStatus.PROCESSING);
        return job;
    }

    private MediaJobStage stage(UUID jobId, MediaJobStage.StageName name, MediaJobStage.StageStatus status) {
        MediaJobStage s = new MediaJobStage();
        s.setId(UUID.randomUUID());
        s.setMediaJobId(jobId);
        s.setStageName(name);
        s.setStageOrder(name.order());
        s.setStatus(status);
        return s;
    }

    @Test
    void rerunFromStage_precedingStageNotCompleted_throwsStageNotReady() {
        UUID jobId = UUID.randomUUID();
        MediaJob job = existingJob(jobId);
        when(mediaJobRepository.findByIdAndWorkspaceId(jobId, workspaceId)).thenReturn(Optional.of(job));
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        List<MediaJobStage> stages = List.of(
                stage(jobId, MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.PENDING),
                stage(jobId, MediaJobStage.StageName.SOURCE_SEPARATION, MediaJobStage.StageStatus.SKIPPED),
                stage(jobId, MediaJobStage.StageName.STT, MediaJobStage.StageStatus.PENDING),
                stage(jobId, MediaJobStage.StageName.SUMMARIZE, MediaJobStage.StageStatus.SKIPPED),
                stage(jobId, MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.PENDING),
                stage(jobId, MediaJobStage.StageName.TTS, MediaJobStage.StageStatus.SKIPPED),
                stage(jobId, MediaJobStage.StageName.AUDIO_MIX, MediaJobStage.StageStatus.SKIPPED),
                stage(jobId, MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.PENDING));
        when(mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(stages);

        AppException ex = assertThrows(AppException.class, () ->
                service.rerunFromStage(workspaceId, userId, jobId, MediaJobStage.StageName.TRANSLATE));
        assertEquals(ErrorCode.STAGE_NOT_READY, ex.getErrorCode());
    }

    @Test
    void rerunFromStage_precedingStagesDone_resetsTargetAndAfterButKeepsSkippedAndBefore() {
        UUID jobId = UUID.randomUUID();
        MediaJob job = existingJob(jobId);
        when(mediaJobRepository.findByIdAndWorkspaceId(jobId, workspaceId)).thenReturn(Optional.of(job));
        when(mediaJobRepository.findWithLockById(jobId)).thenReturn(Optional.of(job));
        when(mediaJobRepository.save(any(MediaJob.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaJobStage extract = stage(jobId, MediaJobStage.StageName.EXTRACT_AUDIO, MediaJobStage.StageStatus.COMPLETED);
        MediaJobStage sourceSep = stage(jobId, MediaJobStage.StageName.SOURCE_SEPARATION, MediaJobStage.StageStatus.SKIPPED);
        MediaJobStage stt = stage(jobId, MediaJobStage.StageName.STT, MediaJobStage.StageStatus.COMPLETED);
        MediaJobStage summarize = stage(jobId, MediaJobStage.StageName.SUMMARIZE, MediaJobStage.StageStatus.SKIPPED);
        MediaJobStage translate = stage(jobId, MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.COMPLETED);
        MediaJobStage tts = stage(jobId, MediaJobStage.StageName.TTS, MediaJobStage.StageStatus.SKIPPED);
        MediaJobStage audioMix = stage(jobId, MediaJobStage.StageName.AUDIO_MIX, MediaJobStage.StageStatus.SKIPPED);
        MediaJobStage render = stage(jobId, MediaJobStage.StageName.RENDER, MediaJobStage.StageStatus.FAILED);
        List<MediaJobStage> stages = List.of(extract, sourceSep, stt, summarize, translate, tts, audioMix, render);
        when(mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)).thenReturn(stages);

        MediaJob result = service.rerunFromStage(workspaceId, userId, jobId, MediaJobStage.StageName.TRANSLATE);

        assertEquals(MediaJob.JobStatus.PENDING, result.getStatus());
        assertEquals(MediaJobStage.StageStatus.COMPLETED, extract.getStatus());
        assertEquals(MediaJobStage.StageStatus.COMPLETED, stt.getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, sourceSep.getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, summarize.getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, translate.getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, tts.getStatus());
        assertEquals(MediaJobStage.StageStatus.SKIPPED, audioMix.getStatus());
        assertEquals(MediaJobStage.StageStatus.PENDING, render.getStatus());
    }

    // ---- checkpoint ----

    @Test
    void confirmCheckpoint_autoWorkflow_throwsValidationError() {
        UUID jobId = UUID.randomUUID();
        MediaJob job = existingJob(jobId);
        job.setWorkflowMode(MediaJob.WorkflowMode.AUTO);
        job.setCreatedByUserId(userId);
        when(mediaJobRepository.findByIdAndWorkspaceId(jobId, workspaceId)).thenReturn(Optional.of(job));
        when(access.getRole(workspaceId, userId)).thenReturn(Role.LEAD);

        AppException ex = assertThrows(AppException.class, () ->
                service.confirmCheckpoint(workspaceId, userId, jobId, Checkpoint.CUT_CONFIRMED));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void confirmCheckpoint_manualWorkflow_persistsMarkerOnOwnerStage() {
        UUID jobId = UUID.randomUUID();
        MediaJob job = existingJob(jobId);
        job.setWorkflowMode(MediaJob.WorkflowMode.MANUAL);
        job.setCreatedByUserId(userId);
        when(mediaJobRepository.findByIdAndWorkspaceId(jobId, workspaceId)).thenReturn(Optional.of(job));
        when(access.getRole(workspaceId, userId)).thenReturn(Role.LEAD);
        MediaJobStage translateStage = stage(jobId, MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.PENDING);
        when(mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.TRANSLATE))
                .thenReturn(Optional.of(translateStage));

        service.confirmCheckpoint(workspaceId, userId, jobId, Checkpoint.CUT_CONFIRMED);

        assertNotNull(translateStage.getInputRef());
        assertTrue(translateStage.getInputRef().contains("CUT_CONFIRMED"));
        verify(mediaJobStageRepository).save(translateStage);
    }
}
