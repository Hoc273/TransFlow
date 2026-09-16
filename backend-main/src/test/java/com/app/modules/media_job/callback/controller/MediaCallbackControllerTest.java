package com.app.modules.media_job.callback.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.repository.UserRepository;
import com.app.modules.batch.repository.LocalizationBatchRepository;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import com.app.modules.media_asset.entity.TermsVersion;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.repository.MediaConsentRepository;
import com.app.modules.media_asset.repository.TermsVersionRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_asset.service.VideoDurationProbe;
import com.app.modules.media_job.callback.service.CallbackDedupeStore;
import com.app.modules.media_job.callback.util.HmacVerifier;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
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
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class MediaCallbackControllerTest {

    // Must match backend-main/src/test/resources/application.yaml app.media-worker.hmac-secret.
    private static final String SECRET = "test-media-worker-hmac-secret";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Autowired private UserRepository userRepository;
    @Autowired private WorkspaceRepository workspaceRepository;
    @Autowired private WorkspaceMemberRepository workspaceMemberRepository;
    @Autowired private ProjectRepository projectRepository;
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
    // Real Redis isn't available in this test JVM (no Testcontainers) — mock the dedupe store like the
    // other Redis-backed collaborators (RefineSessionStore, BatchCreateRateLimiter) in sibling tests.
    @MockBean private CallbackDedupeStore dedupeStore;

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

    private record Lead(String accessToken, UUID workspaceId, UUID projectId) {
    }

    private Lead registerLeadWithWorkspace(String email) throws Exception {
        RegisterRequest req = new RegisterRequest(email, "Password123!", "Lead " + email);
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new Lead(data.path("accessToken").asText(),
                UUID.fromString(data.path("workspaceId").asText()),
                UUID.fromString(data.path("projectId").asText()));
    }

    private UUID createLocalizationJob(Lead lead) throws Exception {
        MvcResult upload = mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(new MockMultipartFile("file", "clip.mp4", "video/mp4", "fake-video-bytes".getBytes()))
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

        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");
        MvcResult result = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText());
    }

    private UUID stageId(UUID jobId, MediaJobStage.StageName name) {
        return mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, name).orElseThrow().getId();
    }

    private MvcResult signedPost(String path, String rawBody) throws Exception {
        long ts = Instant.now().getEpochSecond();
        String sig = HmacVerifier.sign(SECRET, ts, rawBody);
        return mockMvc.perform(post(path)
                        .header("X-Signature", sig)
                        .header("X-Timestamp", ts)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(rawBody))
                .andReturn();
    }

    // ---- HMAC auth ----

    @Test
    void progress_missingSignature_isUnauthenticated() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-nosig@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "jobId", jobId, "stageId", stageId, "dedupeKey", "dk-1", "progressPercent", 10));

        mockMvc.perform(post("/internal/media/extract-audio/progress")
                        .header("X-Timestamp", Instant.now().getEpochSecond())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest()); // missing required header -> Spring 400, not reaching HMAC check
    }

    @Test
    void progress_wrongSignature_isUnauthenticated() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-badsig@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "jobId", jobId, "stageId", stageId, "dedupeKey", "dk-1", "progressPercent", 10));

        mockMvc.perform(post("/internal/media/extract-audio/progress")
                        .header("X-Signature", "0000000000000000000000000000000000000000000000000000000000000000")
                        .header("X-Timestamp", Instant.now().getEpochSecond())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }

    @Test
    void progress_staleTimestamp_isUnauthenticated() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-stale@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "jobId", jobId, "stageId", stageId, "dedupeKey", "dk-1", "progressPercent", 10));
        long staleTs = Instant.now().getEpochSecond() - 600;
        String sig = HmacVerifier.sign(SECRET, staleTs, body);

        mockMvc.perform(post("/internal/media/extract-audio/progress")
                        .header("X-Signature", sig)
                        .header("X-Timestamp", staleTs)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }

    @Test
    void progress_unknownStagePath_returnsValidationError() throws Exception {
        String body = "{}";
        long ts = Instant.now().getEpochSecond();
        String sig = HmacVerifier.sign(SECRET, ts, body);

        mockMvc.perform(post("/internal/media/not-a-stage/progress")
                        .header("X-Signature", sig)
                        .header("X-Timestamp", ts)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    // ---- progress ----

    @Test
    void progress_validSignature_updatesStageAndJob() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-progress@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "jobId", jobId, "stageId", stageId, "dedupeKey", "dk-progress-1", "progressPercent", 55));

        signedPost("/internal/media/extract-audio/progress", body)
                .getResponse();

        var stage = mediaJobStageRepository.findById(stageId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(MediaJobStage.StageStatus.PROCESSING, stage.getStatus());
        org.junit.jupiter.api.Assertions.assertEquals(55, stage.getProgressPercent());
        var job = mediaJobRepository.findById(jobId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(
                com.app.modules.media_job.entity.MediaJob.JobStatus.PROCESSING, job.getStatus());
    }

    @Test
    void progress_repeatedDedupeKey_doesNotReprocess() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-dedupe@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        String body1 = objectMapper.writeValueAsString(java.util.Map.of(
                "jobId", jobId, "stageId", stageId, "dedupeKey", "dk-fixed", "progressPercent", 20));
        String body2 = objectMapper.writeValueAsString(java.util.Map.of(
                "jobId", jobId, "stageId", stageId, "dedupeKey", "dk-fixed", "progressPercent", 90));
        when(dedupeStore.isProcessed("dk-fixed")).thenReturn(false, true);

        long ts1 = Instant.now().getEpochSecond();
        mockMvc.perform(post("/internal/media/extract-audio/progress")
                        .header("X-Signature", HmacVerifier.sign(SECRET, ts1, body1))
                        .header("X-Timestamp", ts1)
                        .contentType(MediaType.APPLICATION_JSON).content(body1))
                .andExpect(status().isOk());

        long ts2 = Instant.now().getEpochSecond();
        mockMvc.perform(post("/internal/media/extract-audio/progress")
                        .header("X-Signature", HmacVerifier.sign(SECRET, ts2, body2))
                        .header("X-Timestamp", ts2)
                        .contentType(MediaType.APPLICATION_JSON).content(body2))
                .andExpect(status().isOk());

        var stage = mediaJobStageRepository.findById(stageId).orElseThrow();
        // second call reused the same dedupeKey -> ignored, progress stays at the first call's value.
        org.junit.jupiter.api.Assertions.assertEquals(20, stage.getProgressPercent());
    }

    // ---- complete ----

    @Test
    void complete_success_marksStageCompletedAndJobProcessingWhenMoreStagesRemain() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-complete-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        var body = objectMapper.createObjectNode();
        body.put("jobId", jobId.toString());
        body.put("stageId", stageId.toString());
        body.put("dedupeKey", "dk-complete-1");
        body.putObject("outputRef").put("key", "audio/extracted.wav");
        body.put("success", true);
        String rawBody = objectMapper.writeValueAsString(body);

        long ts = Instant.now().getEpochSecond();
        mockMvc.perform(post("/internal/media/extract-audio/complete")
                        .header("X-Signature", HmacVerifier.sign(SECRET, ts, rawBody))
                        .header("X-Timestamp", ts)
                        .contentType(MediaType.APPLICATION_JSON).content(rawBody))
                .andExpect(status().isOk());

        var stage = mediaJobStageRepository.findById(stageId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(MediaJobStage.StageStatus.COMPLETED, stage.getStatus());
        org.junit.jupiter.api.Assertions.assertNotNull(stage.getOutputRef());
        var job = mediaJobRepository.findById(jobId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(
                com.app.modules.media_job.entity.MediaJob.JobStatus.PROCESSING, job.getStatus());
    }

    @Test
    void complete_failure_marksStageFailedAndJobFailed() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-cb-complete-fail@transflow.com");
        UUID jobId = createLocalizationJob(lead);
        UUID stageId = stageId(jobId, MediaJobStage.StageName.EXTRACT_AUDIO);
        var body = objectMapper.createObjectNode();
        body.put("jobId", jobId.toString());
        body.put("stageId", stageId.toString());
        body.put("dedupeKey", "dk-complete-fail-1");
        body.put("success", false);
        body.put("errorMessage", "ffmpeg exited with code 1");
        String rawBody = objectMapper.writeValueAsString(body);

        long ts = Instant.now().getEpochSecond();
        mockMvc.perform(post("/internal/media/extract-audio/complete")
                        .header("X-Signature", HmacVerifier.sign(SECRET, ts, rawBody))
                        .header("X-Timestamp", ts)
                        .contentType(MediaType.APPLICATION_JSON).content(rawBody))
                .andExpect(status().isOk());

        var stage = mediaJobStageRepository.findById(stageId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(MediaJobStage.StageStatus.FAILED, stage.getStatus());
        org.junit.jupiter.api.Assertions.assertEquals("ffmpeg exited with code 1", stage.getErrorMessage());
        var job = mediaJobRepository.findById(jobId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertEquals(
                com.app.modules.media_job.entity.MediaJob.JobStatus.FAILED, job.getStatus());
    }
}
