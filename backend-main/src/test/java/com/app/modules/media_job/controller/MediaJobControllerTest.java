package com.app.modules.media_job.controller;

import com.app.testsupport.TestRegistration;

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
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
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
import static org.junit.jupiter.api.Assertions.assertTrue;
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
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;
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
    private PlatformAiProviderRepository platformAiProviderRepository;
    @Autowired
    private MediaJobRepository mediaJobRepository;
    @Autowired
    private MediaJobStageRepository mediaJobStageRepository;
    @Autowired
    private SubtitleSegmentRepository subtitleSegmentRepository;

    @Autowired
    private com.app.modules.qa.repository.QaIssueRepository qaIssueRepository;

    @MockBean
    private MediaStorageService storageService;
    @MockBean
    private VideoDurationProbe durationProbe;

    @BeforeEach
    void setUpAndCleanDb() {
        qaIssueRepository.deleteAll();
        subtitleSegmentRepository.deleteAll();
        mediaJobStageRepository.deleteAll();
        mediaJobRepository.deleteAll();
        ttsVoiceRepository.deleteAll();
        platformAiProviderRepository.deleteAll();
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
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", "Lead " + email));
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
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", "User " + email));
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

    private VoiceBinding createVoice(String language) {
        PlatformAiProvider provider = new PlatformAiProvider();
        provider.setId(UUID.randomUUID());
        provider.setProtocol("test-tts");
        provider.setCapabilities(java.util.List.of("TTS"));
        provider.setBaseUrl("https://tts.example.test");
        provider.setApiKeyEnc(new byte[]{1});
        provider.setActive(true);
        provider = platformAiProviderRepository.save(provider);

        TtsVoice voice = new TtsVoice();
        voice.setId(UUID.randomUUID());
        voice.setProviderSource("PLATFORM");
        voice.setPlatformProviderId(provider.getId());
        voice.setLanguage(language);
        voice.setActive(true);
        voice = ttsVoiceRepository.save(voice);
        return new VoiceBinding(provider.getId(), voice.getId());
    }

    private record VoiceBinding(UUID providerId, UUID voiceId) {}

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
        VoiceBinding voice = createVoice("en");

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");
        body.put("outputAudioMode", "DUB_MIX");
        body.put("sourceSeparationEnabled", false);
        body.put("ttsProviderId", voice.providerId().toString());
        body.put("ttsVoiceId", voice.voiceId().toString());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void createJob_summaryGenerativeAlias_mapsToScriptMatchAndSucceeds() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-summarygen@transflow.com");
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "summary.generative");
        body.put("targetLang", "en");
        body.put("requestedDurationSeconds", 60);
        body.put("sourceLang", "vi");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.recipeId").value("summary.script_match"))
                .andExpect(jsonPath("$.data.sourceLanguage").value("vi"))
                .andExpect(jsonPath("$.data.stages").isArray());
    }

    @Test
    void createJob_voiceLanguageMismatch_returnsBusinessError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-voicemismatch@transflow.com");
        UUID assetId = uploadAndConsentAsset(lead, lead.accessToken());
        VoiceBinding voice = createVoice("fr"); // wrong language vs targetLang=en

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");
        body.put("outputAudioMode", "DUB_REPLACE");
        body.put("ttsProviderId", voice.providerId().toString());
        body.put("ttsVoiceId", voice.voiceId().toString());

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
                .andExpect(jsonPath("$.data.status").value("CANCELLED"))
                .andExpect(jsonPath("$.data.stages").isArray());

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
    void confirmCheckpoint_shortAlias_succeeds() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-checkpoint-short@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId
                        + "/checkpoints/CUT/confirm")
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
        VoiceBinding voice = createVoice("en");

        var body = objectMapper.createObjectNode();
        body.put("ttsProviderId", voice.providerId().toString());
        body.put("ttsVoiceId", voice.voiceId().toString());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/voice")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.ttsProviderId").value(voice.providerId().toString()))
                .andExpect(jsonPath("$.data.ttsVoiceId").value(voice.voiceId().toString()))
                .andExpect(jsonPath("$.data.stages").isArray());
    }

    @Test
    void setVoice_providerDoesNotOwnVoice_returnsValidationError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-voice-provider-mismatch@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        VoiceBinding voice = createVoice("en");

        var body = objectMapper.createObjectNode();
        body.put("ttsProviderId", UUID.randomUUID().toString());
        body.put("ttsVoiceId", voice.voiceId().toString());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/voice")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
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

    private com.app.modules.media_job.entity.SubtitleSegment saveSubtitle(UUID jobId, int seq, long start, long end) {
        var s = new com.app.modules.media_job.entity.SubtitleSegment();
        s.setMediaJobId(jobId);
        s.setSeq(seq);
        s.setContentSource(com.app.modules.media_job.entity.SubtitleSegment.ContentSource.TRANSLATED_ORIGINAL);
        s.setTargetText("t" + seq);
        s.setStartMs(start);
        s.setEndMs(end);
        return subtitleSegmentRepository.save(s);
    }

    private String batchBody(Object... segmentIdAndText) {
        var updates = objectMapper.createArrayNode();
        for (int i = 0; i < segmentIdAndText.length; i += 2) {
            var u = updates.addObject();
            u.put("segmentId", segmentIdAndText[i].toString());
            u.put("targetText", segmentIdAndText[i + 1].toString());
        }
        var body = objectMapper.createObjectNode();
        body.set("updates", updates);
        return body.toString();
    }

    @Test
    void batchUpdateSubtitles_updatesAllAndStalesDownstreamOnce_idempotent() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        var s1 = saveSubtitle(jobId, 1, 0, 1000);
        var s2 = saveSubtitle(jobId, 2, 1000, 2000);
        var render = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow();
        render.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(render);

        String url = "/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/segments/batch";
        for (int i = 0; i < 2; i++) { // second call must give the same result
            mockMvc.perform(put(url).header("Authorization", "Bearer " + lead.accessToken())
                            .contentType(MediaType.APPLICATION_JSON).content(batchBody(s2.getId(), "B", s1.getId(), "A")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.length()").value(2))
                    .andExpect(jsonPath("$.data[0].targetText").value("B"))
                    .andExpect(jsonPath("$.data[1].targetText").value("A"));
        }
        assertEquals(MediaJobStage.StageStatus.STALE,
                mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow().getStatus());
    }

    @Test
    void batchUpdateSubtitles_segmentOfOtherJob_returns400AndChangesNothing() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-foreign@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        UUID otherJobId = createLocalizationJob(lead, "en");
        var mine = saveSubtitle(jobId, 1, 0, 1000);
        var foreign = saveSubtitle(otherJobId, 1, 0, 1000);

        mockMvc.perform(put("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/segments/batch")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON).content(batchBody(mine.getId(), "X", foreign.getId(), "Y")))
                .andExpect(status().isBadRequest());

        assertEquals("t1", subtitleSegmentRepository.findById(mine.getId()).orElseThrow().getTargetText());
        assertEquals("t1", subtitleSegmentRepository.findById(foreign.getId()).orElseThrow().getTargetText());
    }

    @Test
    void batchUpdateSubtitles_invalidTimeRange_returns400() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-time@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        var s = saveSubtitle(jobId, 1, 0, 1000);

        var item = objectMapper.createObjectNode();
        item.put("segmentId", s.getId().toString());
        item.put("startMs", 2000); // >= existing endMs after merge
        var body = objectMapper.createObjectNode();
        body.putArray("updates").add(item);

        mockMvc.perform(put("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/segments/batch")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON).content(body.toString()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void batchUpdateSubtitles_memberOnOthersJobAndClient_areForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-rbac@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        var s = saveSubtitle(jobId, 1, 0, 1000);

        RegisteredUser member = registerPlainUser("member-batch-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), member.userId(), lead.userId());
        RegisteredUser client = registerPlainUser("client-batch-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        String url = "/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/segments/batch";
        for (String token : new String[]{member.accessToken(), client.accessToken()}) {
            mockMvc.perform(put(url).header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON).content(batchBody(s.getId(), "X")))
                    .andExpect(status().isForbidden());
        }
    }

    // ---- render-config ----

    private String renderUrl(Lead lead, UUID jobId, String suffix) {
        return "/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/" + suffix;
    }

    private void putRenderConfig(Lead lead, UUID jobId, String json, int expectedStatus) throws Exception {
        mockMvc.perform(put(renderUrl(lead, jobId, "render-config"))
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expectedStatus));
    }

    @Test
    void renderConfig_unconfiguredJob_returnsDefaults() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rc-default@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        mockMvc.perform(get(renderUrl(lead, jobId, "render-config"))
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.subtitlePosition").value("BOTTOM"))
                .andExpect(jsonPath("$.data.verticalOffsetPercent").value(0))
                .andExpect(jsonPath("$.data.backgroundBox").value(false))
                .andExpect(jsonPath("$.data.outputAspectRatio").value("ORIGINAL"))
                .andExpect(jsonPath("$.data.confirmed").value(false))
                .andExpect(jsonPath("$.data.effective.resolvedLinePercent").value(88));
    }

    @Test
    void renderConfig_partialPut_keepsOtherFields_andStalesFinishedRender() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rc-put@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        var render = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow();
        render.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(render);

        putRenderConfig(lead, jobId, "{\"outputAspectRatio\":\"9:16\",\"presentation\":{\"subtitle\":{\"layers\":["
                + "{\"layerType\":\"COVER_BOX\",\"xPercent\":10,\"yPercent\":80,\"widthPercent\":50,\"heightPercent\":10,"
                + "\"colorHex\":\"#000000\",\"opacity\":0.8}]},\"audio\":{\"ducking\":{\"enabled\":true,\"gainDb\":-12}}}}", 200);
        putRenderConfig(lead, jobId, "{\"subtitlePosition\":\"TOP\",\"verticalOffsetPercent\":5}", 200);

        mockMvc.perform(get(renderUrl(lead, jobId, "render-config"))
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.outputAspectRatio").value("9:16")) // kept from 1st PUT
                .andExpect(jsonPath("$.data.subtitlePosition").value("TOP"))
                .andExpect(jsonPath("$.data.presentation.subtitle.layers.length()").value(1))
                .andExpect(jsonPath("$.data.presentation.audio.ducking.gainDb").value(-12.0))
                .andExpect(jsonPath("$.data.effective.resolvedLinePercent").value(15));
        assertEquals(MediaJobStage.StageStatus.STALE,
                mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow().getStatus());
    }

    @Test
    void renderConfig_invalidValues_return400() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rc-invalid@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        putRenderConfig(lead, jobId, "{\"outputAspectRatio\":\"21:9\"}", 400);
        putRenderConfig(lead, jobId, "{\"subtitleMode\":\"BURNED\"}", 400);
        putRenderConfig(lead, jobId, "{\"verticalOffsetPercent\":31}", 400);
        putRenderConfig(lead, jobId, "{\"backgroundColor\":\"#000000\"}", 400); // needs #RRGGBBAA
        putRenderConfig(lead, jobId, "{\"presentation\":{\"subtitle\":{\"layers\":[{\"layerType\":\"COVER_BOX\","
                + "\"xPercent\":10,\"yPercent\":80,\"widthPercent\":5,\"heightPercent\":10}]}}}", 400); // width < 20
    }

    @Test
    void renderConfig_layerCountCappedAtWorkerLimit() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rc-layers@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        String layer = "{\"layerType\":\"COVER_BOX\",\"xPercent\":10,\"yPercent\":80,\"widthPercent\":50,\"heightPercent\":10}";

        // 4 layers (the worker's max) are accepted, 5 are rejected up front instead of failing later at render time
        putRenderConfig(lead, jobId, "{\"presentation\":{\"subtitle\":{\"layers\":[" + String.join(",", java.util.Collections.nCopies(4, layer)) + "]}}}", 200);
        putRenderConfig(lead, jobId, "{\"presentation\":{\"subtitle\":{\"layers\":[" + String.join(",", java.util.Collections.nCopies(5, layer)) + "]}}}", 400);
    }

    @Test
    void rerunRender_requiresEarlierStagesDone_thenResetsRender() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rc-rerun@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        String url = renderUrl(lead, jobId, "rerun-render");

        mockMvc.perform(post(url).header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isConflict());

        for (var st : mediaJobStageRepository.findByMediaJobIdOrderByStageOrder(jobId)) {
            if (st.getStageName() != MediaJobStage.StageName.RENDER) {
                st.setStatus(MediaJobStage.StageStatus.COMPLETED);
                mediaJobStageRepository.save(st);
            }
        }
        mockMvc.perform(post(url).header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"outputAspectRatio\":\"1:1\"}"))
                .andExpect(status().isAccepted());

        mockMvc.perform(get(renderUrl(lead, jobId, "render-config"))
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.outputAspectRatio").value("1:1"));
    }

    @Test
    void renderConfig_memberOnOthersJobAndClient_forbiddenToWrite_clientCanRead() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-rc-rbac@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        RegisteredUser member = registerPlainUser("member-rc-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), member.userId(), lead.userId());
        RegisteredUser client = registerPlainUser("client-rc-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        for (String token : new String[]{member.accessToken(), client.accessToken()}) {
            mockMvc.perform(put(renderUrl(lead, jobId, "render-config")).header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON).content("{\"subtitlePosition\":\"TOP\"}"))
                    .andExpect(status().isForbidden());
            mockMvc.perform(post(renderUrl(lead, jobId, "rerun-render")).header("Authorization", "Bearer " + token))
                    .andExpect(status().isForbidden());
        }
        mockMvc.perform(get(renderUrl(lead, jobId, "render-config")).header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk());
    }

    // ---- output-package / publish-package ----

    private String pkgUrl(Lead lead, UUID jobId, String suffix) {
        return "/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/" + suffix;
    }

    private void putPublish(Lead lead, UUID jobId, String token, String json, int expected) throws Exception {
        mockMvc.perform(put(pkgUrl(lead, jobId, "publish-package")).header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().is(expected));
    }

    @Test
    void outputPackage_requiresRender_thenListsTracksAndSubtitles() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-outpkg@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        String auth = "Bearer " + lead.accessToken();
        org.mockito.Mockito.when(storageService.presignedGetUrl(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("http://minio/signed");

        mockMvc.perform(get(pkgUrl(lead, jobId, "output-package")).header("Authorization", auth))
                .andExpect(status().isConflict()); // RENDER not done

        completeJobWithOutput(jobId);
        var tts = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.TTS).orElseThrow();
        tts.setStatus(MediaJobStage.StageStatus.COMPLETED);
        tts.setOutputRef("\"transflow-media/audio/tts.wav\"");
        mediaJobStageRepository.save(tts);
        saveSubtitle(jobId, 1, 0, 1000);

        RegisteredUser client = registerPlainUser("client-outpkg@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(get(pkgUrl(lead, jobId, "output-package")).header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.primaryVideoDownloadUrl").value("http://minio/signed"))
                .andExpect(jsonPath("$.data.primaryVideoRef").value("transflow-media/out/" + jobId + ".mp4"))
                .andExpect(jsonPath("$.data.audioTracks[0].role").value("ORIGINAL"))
                .andExpect(jsonPath("$.data.audioTracks[1].role").value("DUB"))
                .andExpect(jsonPath("$.data.audioTracks[1].downloadUrl").value("http://minio/signed"))
                .andExpect(jsonPath("$.data.subtitleTracks.length()").value(2))
                .andExpect(jsonPath("$.data.subtitleTracks[1].format").value("VTT"))
                .andExpect(jsonPath("$.data.subtitleTracks[1].available").value(true))
                .andExpect(jsonPath("$.data.subtitleTracks[1].language").value("en"));
    }

    @Test
    void publishPackage_defaultsThenPartialPut_andValidation() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-pubpkg@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        String auth = "Bearer " + lead.accessToken();

        mockMvc.perform(get(pkgUrl(lead, jobId, "publish-package")).header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.profile").value("GENERIC"))
                .andExpect(jsonPath("$.data.status").value("DRAFT"))
                .andExpect(jsonPath("$.data.language").value("en"))
                .andExpect(jsonPath("$.data.tags.length()").value(0))
                .andExpect(jsonPath("$.data.sourceJobId").value(jobId.toString()));

        putPublish(lead, jobId, lead.accessToken(), "{\"title\":\"My video\",\"tags\":[\"a\",\"b\"]}", 200);
        putPublish(lead, jobId, lead.accessToken(), "{\"description\":\"desc\",\"language\":\"vi\"}", 200);
        mockMvc.perform(get(pkgUrl(lead, jobId, "publish-package")).header("Authorization", auth))
                .andExpect(jsonPath("$.data.title").value("My video")) // kept from 1st PUT
                .andExpect(jsonPath("$.data.description").value("desc"))
                .andExpect(jsonPath("$.data.language").value("vi"))
                .andExpect(jsonPath("$.data.tags.length()").value(2));

        putPublish(lead, jobId, lead.accessToken(), "{\"title\":\"" + "x".repeat(101) + "\"}", 400);
        putPublish(lead, jobId, lead.accessToken(), "{\"description\":\"" + "x".repeat(5001) + "\"}", 400);
        putPublish(lead, jobId, lead.accessToken(), "{\"language\":\"not a lang\"}", 400);
        String tooManyTags = "[" + java.util.stream.IntStream.range(0, 31).mapToObj(i -> "\"t" + i + "\"")
                .collect(java.util.stream.Collectors.joining(",")) + "]";
        putPublish(lead, jobId, lead.accessToken(), "{\"tags\":" + tooManyTags + "}", 400);
        putPublish(lead, jobId, lead.accessToken(), "{\"tags\":[\"" + "x".repeat(51) + "\"]}", 400);
    }

    @Test
    void publishPackage_rbac_andQaGate() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-pubpkg-rbac@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        RegisteredUser member = registerPlainUser("member-pubpkg-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), member.userId(), lead.userId());
        RegisteredUser client = registerPlainUser("client-pubpkg-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        putPublish(lead, jobId, member.accessToken(), "{\"title\":\"x\"}", 403);  // not the job creator
        putPublish(lead, jobId, client.accessToken(), "{\"title\":\"x\"}", 403);
        mockMvc.perform(get(pkgUrl(lead, jobId, "publish-package")).header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk());

        var seg = saveSubtitle(jobId, 1, 0, 1000);
        var issue = new com.app.modules.qa.entity.QaIssue();
        issue.setSubtitleSegmentId(seg.getId());
        issue.setIssueType("TEST");
        issue.setSeverity(com.app.modules.qa.entity.QaIssue.Severity.CRITICAL);
        issue.setBlockingActions(java.util.List.of("BLOCK_PUBLISH"));
        issue.setCreatedAt(java.time.Instant.now());
        qaIssueRepository.save(issue);
        putPublish(lead, jobId, lead.accessToken(), "{\"title\":\"x\"}", 403); // QA_BLOCKED
        mockMvc.perform(get(pkgUrl(lead, jobId, "publish-package")).header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk()); // reading the draft is not gated
    }

    // ---- override source language ----

    private org.springframework.test.web.servlet.ResultActions overrideLang(Lead lead, UUID jobId, String token, String lang)
            throws Exception {
        String body = lang == null ? "{}" : "{\"sourceLang\":\"" + lang + "\"}";
        return mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/override-source-lang")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private void setStageStatus(UUID jobId, MediaJobStage.StageName name, MediaJobStage.StageStatus status) {
        var stage = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, name).orElseThrow();
        stage.setStatus(status);
        mediaJobStageRepository.save(stage);
    }

    private MediaJobStage.StageStatus stageStatus(UUID jobId, MediaJobStage.StageName name) {
        return mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, name).orElseThrow().getStatus();
    }

    @Test
    void overrideSourceLang_setsLangAndStalesTranslateOnward_idempotent() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-lang-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        for (var n : new MediaJobStage.StageName[]{MediaJobStage.StageName.STT, MediaJobStage.StageName.TRANSLATE,
                MediaJobStage.StageName.TTS, MediaJobStage.StageName.RENDER}) {
            setStageStatus(jobId, n, MediaJobStage.StageStatus.COMPLETED);
        }

        overrideLang(lead, jobId, lead.accessToken(), "zh").andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sourceLanguage").value("zh"));
        assertEquals(MediaJobStage.StageStatus.STALE, stageStatus(jobId, MediaJobStage.StageName.TRANSLATE));
        assertEquals(MediaJobStage.StageStatus.STALE, stageStatus(jobId, MediaJobStage.StageName.RENDER));
        assertEquals(MediaJobStage.StageStatus.COMPLETED, stageStatus(jobId, MediaJobStage.StageName.STT)); // STT kept

        // same language again is a no-op: a re-finished TRANSLATE is not staled a second time
        setStageStatus(jobId, MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.COMPLETED);
        overrideLang(lead, jobId, lead.accessToken(), "ZH").andExpect(status().isOk());
        assertEquals(MediaJobStage.StageStatus.COMPLETED, stageStatus(jobId, MediaJobStage.StageName.TRANSLATE));

        overrideLang(lead, jobId, lead.accessToken(), "vi").andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sourceLanguage").value("vi"));
        assertEquals(MediaJobStage.StageStatus.STALE, stageStatus(jobId, MediaJobStage.StageName.TRANSLATE));
    }

    @Test
    void overrideSourceLang_invalidOrNotReady_rejected() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-lang-bad@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");

        overrideLang(lead, jobId, lead.accessToken(), "vi").andExpect(status().isConflict()); // STT not done yet
        setStageStatus(jobId, MediaJobStage.StageName.STT, MediaJobStage.StageStatus.COMPLETED);

        overrideLang(lead, jobId, lead.accessToken(), "xx").andExpect(status().isBadRequest());  // unsupported
        overrideLang(lead, jobId, lead.accessToken(), "en").andExpect(status().isBadRequest());  // = target language
        overrideLang(lead, jobId, lead.accessToken(), " ").andExpect(status().isBadRequest());
        overrideLang(lead, jobId, lead.accessToken(), null).andExpect(status().isBadRequest());

        setStageStatus(jobId, MediaJobStage.StageName.TRANSLATE, MediaJobStage.StageStatus.PROCESSING);
        overrideLang(lead, jobId, lead.accessToken(), "vi").andExpect(status().isConflict());    // in flight
    }

    @Test
    void overrideSourceLang_memberOnOthersJobAndClient_forbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-lang-rbac@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        setStageStatus(jobId, MediaJobStage.StageName.STT, MediaJobStage.StageStatus.COMPLETED);
        RegisteredUser member = registerPlainUser("member-lang-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), member.userId(), lead.userId());
        RegisteredUser client = registerPlainUser("client-lang-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        overrideLang(lead, jobId, member.accessToken(), "vi").andExpect(status().isForbidden());
        overrideLang(lead, jobId, client.accessToken(), "vi").andExpect(status().isForbidden());
    }

    // ---- bulk download ----

    /** Marks the job COMPLETED with a rendered output so it passes the publish checks. */
    private void completeJobWithOutput(UUID jobId) {
        var job = mediaJobRepository.findById(jobId).orElseThrow();
        job.setStatus(com.app.modules.media_job.entity.MediaJob.JobStatus.COMPLETED);
        mediaJobRepository.save(job);
        var render = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow();
        render.setStatus(MediaJobStage.StageStatus.COMPLETED);
        render.setOutputRef("\"transflow-media/out/" + jobId + ".mp4\"");
        mediaJobStageRepository.save(render);
    }

    private org.springframework.test.web.servlet.ResultActions postDownload(Lead lead, String token, Object... jobIds)
            throws Exception {
        var ids = objectMapper.createArrayNode();
        for (Object id : jobIds) {
            ids.add(id.toString());
        }
        var body = objectMapper.createObjectNode();
        body.set("jobIds", ids);
        return mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId()
                        + "/media/jobs/download")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content(body.toString()));
    }

    @Test
    void bulkDownload_zipsCompletedJobs_skipsOthers_andCleansUp() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-bulk-ok@transflow.com");
        UUID a = createLocalizationJob(lead, "en");
        UUID b = createLocalizationJob(lead, "vi");
        UUID pending = createLocalizationJob(lead, "en");
        completeJobWithOutput(a);
        completeJobWithOutput(b);
        UUID unknown = UUID.randomUUID();

        org.mockito.Mockito.when(storageService.mediaBucket()).thenReturn("transflow-media");
        org.mockito.Mockito.when(storageService.presignedGetUrl(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("http://minio/zip");
        org.mockito.Mockito.when(storageService.getMediaObject(org.mockito.ArgumentMatchers.anyString()))
                .thenAnswer(inv -> new java.io.ByteArrayInputStream("VIDEO".getBytes()));
        java.util.List<String> entries = new java.util.ArrayList<>();
        org.mockito.Mockito.doAnswer(inv -> {
            try (var zin = new java.util.zip.ZipInputStream(inv.<java.io.InputStream>getArgument(1))) {
                for (var e = zin.getNextEntry(); e != null; e = zin.getNextEntry()) {
                    entries.add(e.getName() + "=" + new String(zin.readAllBytes()));
                }
            }
            return null;
        }).when(storageService).putMediaObject(org.mockito.ArgumentMatchers.startsWith("tmp/downloads/"),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.eq("application/zip"));

        postDownload(lead, lead.accessToken(), a, b, a, pending, unknown) // duplicate a is ignored
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.downloadUrl").value("http://minio/zip"))
                .andExpect(jsonPath("$.data.fileName").value(org.hamcrest.Matchers.endsWith(".zip")))
                .andExpect(jsonPath("$.data.includedJobIds.length()").value(2))
                .andExpect(jsonPath("$.data.skipped.length()").value(2))
                .andExpect(jsonPath("$.data.skipped[?(@.reason=='NOT_COMPLETED')]").exists())
                .andExpect(jsonPath("$.data.skipped[?(@.reason=='NOT_FOUND')]").exists());

        assertEquals(2, entries.size());
        assertTrue(entries.stream().allMatch(e -> e.endsWith(".mp4=VIDEO")));
        assertTrue(entries.stream().anyMatch(e -> e.contains("_en_" + a.toString().substring(0, 8))));
        assertTrue(entries.stream().anyMatch(e -> e.contains("_vi_" + b.toString().substring(0, 8))));
    }

    @Test
    void bulkDownload_validationAndNothingDownloadable() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-bulk-bad@transflow.com");
        UUID pending = createLocalizationJob(lead, "en");

        postDownload(lead, lead.accessToken()).andExpect(status().isBadRequest()); // empty list
        Object[] tooMany = java.util.stream.Stream.generate(UUID::randomUUID).limit(21).toArray();
        postDownload(lead, lead.accessToken(), tooMany)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(2905));
        postDownload(lead, lead.accessToken(), pending) // nothing COMPLETED -> STAGE_NOT_READY
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value(2902));
    }

    @Test
    void bulkDownload_clientAllowed_outsiderForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-bulk-rbac@transflow.com");
        UUID a = createLocalizationJob(lead, "en");
        completeJobWithOutput(a);
        RegisteredUser client = registerPlainUser("client-bulk-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());
        RegisteredUser outsider = registerPlainUser("outsider-bulk-rbac@transflow.com");

        org.mockito.Mockito.when(storageService.mediaBucket()).thenReturn("transflow-media");
        org.mockito.Mockito.when(storageService.presignedGetUrl(org.mockito.ArgumentMatchers.anyString()))
                .thenReturn("http://minio/zip");
        org.mockito.Mockito.when(storageService.getMediaObject(org.mockito.ArgumentMatchers.anyString()))
                .thenAnswer(inv -> new java.io.ByteArrayInputStream("V".getBytes()));

        postDownload(lead, client.accessToken(), a).andExpect(status().isOk());
        postDownload(lead, outsider.accessToken(), a).andExpect(status().isForbidden());
    }

    // ---- subtitle styles ----

    private void postStyle(UUID jobId, String key, String token, int expectedStatus) throws Exception {
        mockMvc.perform(post("/api/media/jobs/" + jobId + "/subtitle-style")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"key\":\"" + key + "\"}"))
                .andExpect(status().is(expectedStatus));
    }

    private void setRenderStatus(UUID jobId, MediaJobStage.StageStatus status) {
        var render = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow();
        render.setStatus(status);
        mediaJobStageRepository.save(render);
    }

    private MediaJobStage.StageStatus renderStatus(UUID jobId) {
        return mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.RENDER).orElseThrow().getStatus();
    }

    @Test
    void subtitleStyles_listAndDetail_andKeyErrors() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-style-list@transflow.com");
        String auth = "Bearer " + lead.accessToken();

        mockMvc.perform(get("/api/media/subtitle-styles").header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(5))
                .andExpect(jsonPath("$.data[0].key").value("style-classic"))
                .andExpect(jsonPath("$.data[0].preview_text").exists());
        mockMvc.perform(get("/api/media/subtitle-styles/style-tiktok").header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("TikTok"))
                .andExpect(jsonPath("$.data.font_family").value("Arial"))
                .andExpect(jsonPath("$.data.margin_v").value(120))
                .andExpect(jsonPath("$.data.opacity").value(100));
        mockMvc.perform(get("/api/media/subtitle-styles/no-such-style").header("Authorization", auth))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value(2903));
        mockMvc.perform(get("/api/media/subtitle-styles/BAD_KEY!").header("Authorization", auth))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(2904));
    }

    @Test
    void subtitleStyle_assign_overwrites_stalesRenderOnlyWhenChanged() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-style-assign@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        String auth = "Bearer " + lead.accessToken();
        String url = "/api/media/jobs/" + jobId + "/subtitle-style";

        mockMvc.perform(get(url).header("Authorization", auth))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value(2903)); // nothing assigned yet

        setRenderStatus(jobId, MediaJobStage.StageStatus.COMPLETED);
        postStyle(jobId, "style-tiktok", lead.accessToken(), 200);
        assertEquals(MediaJobStage.StageStatus.STALE, renderStatus(jobId));

        // same style again: no change => a re-finished RENDER is left alone
        setRenderStatus(jobId, MediaJobStage.StageStatus.COMPLETED);
        postStyle(jobId, "style-tiktok", lead.accessToken(), 200);
        assertEquals(MediaJobStage.StageStatus.COMPLETED, renderStatus(jobId));

        // a different style overwrites
        postStyle(jobId, "style-neon", lead.accessToken(), 200);
        mockMvc.perform(get(url).header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.primary_color").value("#00FFFF"))
                .andExpect(jsonPath("$.data.outline_color").value("#FF00FF"));
        mockMvc.perform(get(renderUrl(lead, jobId, "render-config")).header("Authorization", auth))
                .andExpect(jsonPath("$.data.effective.ownedByStyle").value(true));

        postStyle(jobId, "nope", lead.accessToken(), 404);
    }

    @Test
    void subtitleStyle_memberOnOthersJobAndClient_cannotAssign_clientCanRead() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-style-rbac@transflow.com");
        UUID jobId = createLocalizationJob(lead, "en");
        RegisteredUser member = registerPlainUser("member-style-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), member.userId(), lead.userId());
        RegisteredUser client = registerPlainUser("client-style-rbac@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());
        RegisteredUser outsider = registerPlainUser("outsider-style-rbac@transflow.com");

        postStyle(jobId, "style-classic", member.accessToken(), 403);
        postStyle(jobId, "style-classic", client.accessToken(), 403);
        postStyle(jobId, "style-classic", lead.accessToken(), 200);
        mockMvc.perform(get("/api/media/jobs/" + jobId + "/subtitle-style")
                        .header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/media/jobs/" + jobId + "/subtitle-style")
                        .header("Authorization", "Bearer " + outsider.accessToken()))
                .andExpect(status().isForbidden());
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
