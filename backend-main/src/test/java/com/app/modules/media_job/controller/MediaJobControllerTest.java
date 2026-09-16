package com.app.modules.media_job.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.credit.entity.CreditAccount;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import com.app.modules.media_asset.entity.TermsVersion;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.repository.MediaConsentRepository;
import com.app.modules.media_asset.repository.TermsVersionRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_asset.service.VideoDurationProbe;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.project.entity.ProjectMember;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class MediaJobControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserRepository userRepository;
    @Autowired
    private WorkspaceRepository workspaceRepository;
    @Autowired
    private WorkspaceMemberRepository workspaceMemberRepository;
    @Autowired
    private ProjectRepository projectRepository;
    @Autowired
    private ProjectMemberRepository projectMemberRepository;
    @Autowired
    private MediaAssetRepository mediaAssetRepository;
    @Autowired
    private MediaConsentRepository mediaConsentRepository;
    @Autowired
    private TermsVersionRepository termsVersionRepository;
    @Autowired
    private CreditAccountRepository creditAccountRepository;
    @Autowired
    private CreditTransactionRepository creditTransactionRepository;
    @Autowired
    private WorkspaceBillingConfigRepository workspaceBillingConfigRepository;
    @Autowired
    private TtsVoiceRepository ttsVoiceRepository;
    @Autowired
    private MediaJobRepository mediaJobRepository;
    @Autowired
    private MediaJobStageRepository mediaJobStageRepository;
    @Autowired
    private SubtitleSegmentRepository subtitleSegmentRepository;

    @MockBean
    private MediaStorageService storageService;
    @MockBean
    private VideoDurationProbe durationProbe;

    @BeforeEach
    void setUpAndCleanDb() {
        subtitleSegmentRepository.deleteAll();
        mediaJobStageRepository.deleteAll();
        mediaJobRepository.deleteAll();
        ttsVoiceRepository.deleteAll();
        mediaConsentRepository.deleteAll();
        mediaAssetRepository.deleteAll();
        workspaceBillingConfigRepository.deleteAll();
        creditTransactionRepository.deleteAll();
        creditAccountRepository.deleteAll();
        projectMemberRepository.deleteAll();
        projectRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();

        termsVersionRepository.deleteAll();
        TermsVersion terms = new TermsVersion();
        terms.setVersion("v1");
        terms.setContentRef("terms/v1.md");
        terms.setCurrent(true);
        terms.setPublishedAt(Instant.now());
        termsVersionRepository.save(terms);

        when(storageService.providerName()).thenReturn("minio");
        when(storageService.mediaBucket()).thenReturn("test-bucket");
        when(durationProbe.extractDurationMs(any())).thenReturn(90_000L);
    }

    private record Lead(String accessToken, UUID userId, UUID workspaceId, UUID projectId) {
    }

    private record RegisteredUser(String accessToken, UUID userId) {
    }

    private Lead registerLeadWithWorkspace(String email) throws Exception {
        RegisterRequest req = new RegisterRequest(email, "Password123!", "Lead " + email);
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Lead(
                data.path("accessToken").asText(),
                UUID.fromString(data.path("user").path("id").asText()),
                UUID.fromString(data.path("workspaceId").asText()),
                UUID.fromString(data.path("projectId").asText()));
    }

    private RegisteredUser registerPlainUser(String email) throws Exception {
        RegisterRequest req = new RegisterRequest(email, "Password123!", "User " + email);
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new RegisteredUser(data.path("accessToken").asText(), UUID.fromString(data.path("user").path("id").asText()));
    }

    private void addWorkspaceMember(UUID workspaceId, UUID userId, Role role) {
        WorkspaceMember member = new WorkspaceMember();
        member.setWorkspaceId(workspaceId);
        member.setUserId(userId);
        member.setRole(role);
        workspaceMemberRepository.save(member);
    }

    private void addProjectMember(UUID projectId, UUID userId, UUID addedBy) {
        ProjectMember pm = new ProjectMember();
        pm.setProjectId(projectId);
        pm.setUserId(userId);
        pm.setAddedBy(addedBy);
        projectMemberRepository.save(pm);
    }

    private UUID uploadAndConsentAsset(Lead lead, String accessToken) throws Exception {
        MvcResult upload = mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(new MockMultipartFile("file", "clip.mp4", "video/mp4", "fake-video-bytes".getBytes()))
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isCreated())
                .andReturn();
        UUID assetId = UUID.fromString(objectMapper.readTree(upload.getResponse().getContentAsString())
                .path("data").path("id").asText());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/assets/" + assetId + "/consent")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"v1\"}"))
                .andExpect(status().isCreated());
        return assetId;
    }

    // Registration already grants app.credit.initial-grant-amount (100.0 in test config);
    // this only overrides that starting balance when a test needs a different one.
    private void setCreditBalance(UUID userId, BigDecimal amount) {
        CreditAccount account = creditAccountRepository.findByUserId(userId).orElseThrow();
        account.setBalance(amount);
        creditAccountRepository.save(account);
    }

    private UUID createVoice(String language) {
        TtsVoice voice = new TtsVoice();
        voice.setId(UUID.randomUUID());
        voice.setLanguage(language);
        return ttsVoiceRepository.save(voice).getId();
    }

    // ---- create ----

    @Test
    void createJob_localizationAsLead_initializesStagesWithSkips() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-create@transflow.com");
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.createdByUserId").value(lead.userId().toString()))
                .andExpect(jsonPath("$.data.stages.length()").value(8))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='SOURCE_SEPARATION')].status").value("SKIPPED"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='SUMMARIZE')].status").value("SKIPPED"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='TTS')].status").value("SKIPPED"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='AUDIO_MIX')].status").value("SKIPPED"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='EXTRACT_AUDIO')].status").value("PENDING"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='RENDER')].status").value("PENDING"));
    }

    @Test
    void createJob_withoutConsent_returnsTermsNotAccepted() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-noconsent@transflow.com");
        MvcResult upload = mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(new MockMultipartFile("file", "clip.mp4", "video/mp4", "x".getBytes()))
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isCreated()).andReturn();
        UUID assetId = UUID.fromString(objectMapper.readTree(upload.getResponse().getContentAsString())
                .path("data").path("id").asText());

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.TERMS_NOT_ACCEPTED.getCode()));
    }

    @Test
    void createJob_asClient_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-client-job@transflow.com");
        RegisteredUser client = registerPlainUser("client-job@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", UUID.randomUUID().toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + client.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHORIZED.getCode()));
    }

    @Test
    void createJob_dubMixWithoutSourceSeparation_returnsValidationError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-dubmix@transflow.com");
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());
        UUID voiceId = createVoice("en");

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");
        body.put("outputAudioMode", "DUB_MIX");
        body.put("sourceSeparationEnabled", false);
        body.put("ttsVoiceId", voiceId.toString());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void createJob_voiceLanguageMismatch_returnsBusinessError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-voicemismatch@transflow.com");
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());
        UUID voiceId = createVoice("fr"); // wrong language vs targetLang=en

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");
        body.put("outputAudioMode", "DUB_REPLACE");
        body.put("ttsVoiceId", voiceId.toString());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VOICE_LANGUAGE_MISMATCH.getCode()));
    }

    @Test
    void createJob_insufficientCredit_returnsPaymentRequired() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-nocredit@transflow.com");
        setCreditBalance(lead.userId(), BigDecimal.ZERO);
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isPaymentRequired())
                .andExpect(jsonPath("$.code").value(ErrorCode.INSUFFICIENT_CREDIT.getCode()));
    }

    // ---- list / get ----

    private UUID createLocalizationJob(Lead lead, String targetLang) throws Exception {
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", targetLang);

        MvcResult result = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText());
    }

    @Test
    void listJobs_returnsCreatedJob() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-list-job@transflow.com");
        createLocalizationJob(lead, "en");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].targetLang").value("en"));
    }

    @Test
    void getJob_notFound_returns404() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-job-404@transflow.com");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.RESOURCE_NOT_FOUND.getCode()));
    }

    // ---- cancel ----

    @Test
    void cancelJob_pendingJob_cancelsJobAndPendingStages() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cancel@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/cancel")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("CANCELLED"));

        var stages = mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        boolean anyStillPending = stages.stream().anyMatch(s -> s.getStatus() == MediaJobStage.StageStatus.PENDING);
        assertEquals(false, anyStillPending);
    }

    // ---- rerun-from-stage ----

    @Test
    void rerunFromStage_precedingStageNotCompleted_returns409() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rerun-409@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/stages/TRANSLATE/rerun")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(ErrorCode.STAGE_NOT_READY.getCode()));
    }

    @Test
    void rerunFromStage_precedingStagesCompleted_resetsTargetAndFollowingStages() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rerun-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        // Simulate EXTRACT_AUDIO/STT already completed by an (unimplemented-in-this-iteration) executor.
        var extractAudio = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.EXTRACT_AUDIO).orElseThrow();
        extractAudio.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(extractAudio);
        var stt = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.STT).orElseThrow();
        stt.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(stt);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/stages/TRANSLATE/rerun")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='TRANSLATE')].status").value("PENDING"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='RENDER')].status").value("PENDING"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='EXTRACT_AUDIO')].status").value("COMPLETED"));
    }

    // ---- checkpoint (job ownership) ----

    @Test
    void confirmCheckpoint_memberNotCreator_isJobOwnershipRequired() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-checkpoint@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        RegisteredUser other = registerPlainUser("member-other-checkpoint@transflow.com");
        addWorkspaceMember(lead.workspaceId(), other.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), other.userId(), lead.userId());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId
                        + "/checkpoints/CUT_CONFIRMED/confirm")
                        .header("Authorization", "Bearer " + other.accessToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.JOB_OWNERSHIP_REQUIRED.getCode()));
    }

    @Test
    void confirmCheckpoint_leadOnAnyJob_succeeds() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-checkpoint-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId
                        + "/checkpoints/CUT_CONFIRMED/confirm")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk());
    }

    @Test
    void confirmCheckpoint_invalidCheckpointValue_returnsValidationError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-checkpoint-badval@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId
                        + "/checkpoints/NOT_A_CHECKPOINT/confirm")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    // ---- voice ----

    @Test
    void setVoice_matchingLanguage_succeeds() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-voice-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        UUID voiceId = createVoice("en");

        var body = objectMapper.createObjectNode();
        body.put("ttsVoiceId", voiceId.toString());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/voice")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ttsVoiceId").value(voiceId.toString()));
    }

    // ---- subtitles ----

    @Test
    void patchSubtitle_afterRenderCompleted_cascadesStaleAndNotifies() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-subtitle-stale@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        var subtitle = new com.app.modules.media_job.entity.SubtitleSegment();
        subtitle.setMediaJobId(jobId);
        subtitle.setSeq(1);
        subtitle.setContentSource(com.app.modules.media_job.entity.SubtitleSegment.ContentSource.TRANSLATED_ORIGINAL);
        subtitle.setTargetText("Hello");
        subtitle.setStartMs(0);
        subtitle.setEndMs(1000);
        subtitle = subtitleSegmentRepository.save(subtitle);

        var render = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow();
        render.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(render);

        var body = objectMapper.createObjectNode();
        body.put("targetText", "Hello edited");

        mockMvc.perform(patch("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId
                        + "/subtitles/" + subtitle.getId())
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.targetText").value("Hello edited"));

        var renderAfter = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow();
        assertEquals(MediaJobStage.StageStatus.STALE, renderAfter.getStatus());
    }

    @Test
    void listSubtitles_asClient_isAllowedReadOnly() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-subtitle-client@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        RegisteredUser client = registerPlainUser("client-subtitle@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/subtitles")
                        .header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }
}
