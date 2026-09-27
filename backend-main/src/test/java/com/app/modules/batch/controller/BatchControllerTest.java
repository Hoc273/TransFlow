package com.app.modules.batch.controller;

import com.app.testsupport.TestRegistration;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.batch.service.BatchCreateRateLimiter;
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
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
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

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class BatchControllerTest {

    @Autowired private MockMvc mockMvc;

    @Autowired
    private com.app.modules.auth.service.RegisterOtpStore registerOtpStore;
    @Autowired private ObjectMapper objectMapper;

    @Autowired private UserRepository userRepository;
    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private WorkspaceMemberRepository workspaceMemberRepository;
    @Autowired private ProjectRepository projectRepository;
    @Autowired private ProjectMemberRepository projectMemberRepository;
    @Autowired private MediaAssetRepository mediaAssetRepository;
    @Autowired private MediaConsentRepository mediaConsentRepository;
    @Autowired private TermsVersionRepository termsVersionRepository;
    @Autowired private CreditAccountRepository creditAccountRepository;
    @Autowired private CreditTransactionRepository creditTransactionRepository;
    @Autowired private WorkspaceBillingConfigRepository workspaceBillingConfigRepository;
    @Autowired private MediaJobRepository mediaJobRepository;
    @Autowired private MediaJobStageRepository mediaJobStageRepository;
    @Autowired private SubtitleSegmentRepository subtitleSegmentRepository;
    @Autowired private LocalizationBatchRepository localizationBatchRepository;

    @MockBean private MediaStorageService storageService;
    @MockBean private VideoDurationProbe durationProbe;
    @MockBean private BatchCreateRateLimiter rateLimiter;

    @BeforeEach
    void setUpAndCleanDb() {
        localizationBatchRepository.deleteAll();
        subtitleSegmentRepository.deleteAll();
        mediaJobStageRepository.deleteAll();
        mediaJobRepository.deleteAll();
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
        when(rateLimiter.isRateLimited(any())).thenReturn(false);
    }

    private record Lead(String accessToken, UUID userId, UUID workspaceId, UUID projectId) {
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

    private UUID uploadAndConsentAsset(Lead lead, String name) throws Exception {
        MvcResult upload = mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(new MockMultipartFile("file", name, "video/mp4", ("bytes-" + name).getBytes()))
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isCreated())
                .andReturn();
        UUID assetId = UUID.fromString(objectMapper.readTree(upload.getResponse().getContentAsString())
                .path("data").path("id").asText());
        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/assets/" + assetId + "/consent")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"v1\"}"))
                .andExpect(status().isCreated());
        return assetId;
    }

    private com.fasterxml.jackson.databind.node.ObjectNode createBatchBody(List<UUID> assetIds, String targetLang) {
        var body = objectMapper.createObjectNode();
        body.put("name", "My batch");
        var arr = body.putArray("sourceAssetIds");
        assetIds.forEach(id -> arr.add(id.toString()));
        body.put("targetLang", targetLang);
        var config = body.putObject("sharedConfig");
        config.put("processingMode", "TRANSLATE_ONLY");
        return body;
    }

    // ---- create ----

    @Test
    void createBatch_asLead_createsOneJobPerAsset() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-create@transflow.com");
        UUID a1 = uploadAndConsentAsset(lead, "a1.mp4");
        UUID a2 = uploadAndConsentAsset(lead, "a2.mp4");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(List.of(a1, a2), "en"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.targetLang").value("en"))
                .andExpect(jsonPath("$.data.jobs.length()").value(2))
                .andExpect(jsonPath("$.data.jobs[0].recipeId").value("localization.full"))
                .andExpect(jsonPath("$.data.jobs[0].targetLang").value("en"))
                .andExpect(jsonPath("$.data.jobs[0].batchId").value(org.hamcrest.Matchers.notNullValue()));
    }

    @Test
    void createBatch_moreThan20Assets_returnsBatchSizeExceeded() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-toolarge@transflow.com");
        List<UUID> fakeIds = java.util.stream.IntStream.range(0, 21).mapToObj(i -> UUID.randomUUID()).toList();

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(fakeIds, "en"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.BATCH_SIZE_EXCEEDED.getCode()));
    }

    @Test
    void createBatch_rateLimited_returns429() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-ratelimit@transflow.com");
        UUID a1 = uploadAndConsentAsset(lead, "a1.mp4");
        when(rateLimiter.isRateLimited(lead.userId())).thenReturn(true);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(List.of(a1), "en"))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value(ErrorCode.BATCH_RATE_LIMIT_EXCEEDED.getCode()));
    }

    // ---- list / get ----

    @Test
    void listAndGetBatch_returnsCreatedBatchWithJobs() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-list@transflow.com");
        UUID a1 = uploadAndConsentAsset(lead, "a1.mp4");
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(List.of(a1), "en"))))
                .andExpect(status().isCreated()).andReturn();
        UUID batchId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(batchId.toString()));

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/batches/" + batchId)
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.jobs.length()").value(1));
    }

    // ---- cancel ----

    @Test
    void cancelBatch_setsCancelledAndCancelsPendingChildJobs() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-cancel@transflow.com");
        UUID a1 = uploadAndConsentAsset(lead, "a1.mp4");
        UUID a2 = uploadAndConsentAsset(lead, "a2.mp4");
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(List.of(a1, a2), "en"))))
                .andExpect(status().isCreated()).andReturn();
        UUID batchId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/batches/" + batchId + "/cancel")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("CANCELLED"))
                .andExpect(jsonPath("$.data.jobs[0].status").value("CANCELLED"))
                .andExpect(jsonPath("$.data.jobs[1].status").value("CANCELLED"));
    }

    // ---- retry ----

    @Test
    void retryChildJob_notFailed_returnsValidationError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-retry-bad@transflow.com");
        UUID a1 = uploadAndConsentAsset(lead, "a1.mp4");
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(List.of(a1), "en"))))
                .andExpect(status().isCreated()).andReturn();
        JsonNode data = objectMapper.readTree(created.getResponse().getContentAsString()).path("data");
        UUID batchId = UUID.fromString(data.path("id").asText());
        UUID jobId = UUID.fromString(data.path("jobs").get(0).path("id").asText());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/batches/" + batchId + "/jobs/" + jobId + "/retry")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void retryChildJob_failedStage_reRunsAndBatchGoesBackToProcessing() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-batch-retry-ok@transflow.com");
        UUID a1 = uploadAndConsentAsset(lead, "a1.mp4");
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/batches")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBatchBody(List.of(a1), "en"))))
                .andExpect(status().isCreated()).andReturn();
        JsonNode data = objectMapper.readTree(created.getResponse().getContentAsString()).path("data");
        UUID batchId = UUID.fromString(data.path("id").asText());
        UUID jobId = UUID.fromString(data.path("jobs").get(0).path("id").asText());

        // Simulate the job having progressed to (and failed on) TRANSLATE — no stage executor built yet
        // to do this for real, so mark the preceding stages COMPLETED directly.
        var extractAudioStage = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.EXTRACT_AUDIO).orElseThrow();
        extractAudioStage.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(extractAudioStage);
        var sttStage = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.STT).orElseThrow();
        sttStage.setStatus(MediaJobStage.StageStatus.COMPLETED);
        mediaJobStageRepository.save(sttStage);
        var translateStage = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.TRANSLATE).orElseThrow();
        translateStage.setStatus(MediaJobStage.StageStatus.FAILED);
        mediaJobStageRepository.save(translateStage);
        var job = mediaJobRepository.findById(jobId).orElseThrow();
        job.setStatus(com.app.modules.media_job.entity.MediaJob.JobStatus.FAILED);
        mediaJobRepository.save(job);
        var batch = localizationBatchRepository.findById(batchId).orElseThrow();
        batch.setStatus(com.app.modules.batch.entity.LocalizationBatch.BatchStatus.FAILED);
        localizationBatchRepository.save(batch);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/batches/" + batchId + "/jobs/" + jobId + "/retry")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='TRANSLATE')].status").value("PENDING"));

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/batches/" + batchId)
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.status").value("PROCESSING"));
    }
}
