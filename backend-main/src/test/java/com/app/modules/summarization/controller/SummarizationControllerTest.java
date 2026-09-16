package com.app.modules.summarization.controller;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.auth.repository.UserRepository;
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
import com.app.modules.summarization.repository.SummaryProposalRepository;
import com.app.modules.summarization.repository.SummaryProposalSegmentRepository;
import com.app.modules.summarization.service.RefineSessionStore;
import com.app.modules.summarization.service.SummaryAiClient;
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
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class SummarizationControllerTest {

    @Autowired private MockMvc mockMvc;
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
    @Autowired private SummaryProposalRepository summaryProposalRepository;
    @Autowired private SummaryProposalSegmentRepository summaryProposalSegmentRepository;

    @MockBean private MediaStorageService storageService;
    @MockBean private VideoDurationProbe durationProbe;
    @MockBean private SummaryAiClient aiClient;
    @MockBean private RefineSessionStore refineSessionStore;

    @BeforeEach
    void setUpAndCleanDb() {
        summaryProposalSegmentRepository.deleteAll();
        summaryProposalRepository.deleteAll();
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
    }

    private record Lead(String accessToken, UUID userId, UUID workspaceId, UUID projectId) {
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

    private UUID uploadAndConsentAsset(Lead lead) throws Exception {
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
        return assetId;
    }

    private UUID createSummaryJob(Lead lead, int requestedDurationSeconds) throws Exception {
        UUID assetId = uploadAndConsentAsset(lead);
        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "summary.script_match");
        body.put("targetLang", "en");
        body.put("requestedDurationSeconds", requestedDurationSeconds);

        MvcResult result = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText());
    }

    // ---- custom proposal CRUD ----

    @Test
    void createCustomProposal_asLead_succeedsAndAppearsInActiveList() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-custom@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        var body = objectMapper.createObjectNode();
        body.putArray("segments").addObject().put("startMs", 0).put("endMs", 30000);
        body.put("reasoningNote", "picked the intro");

        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/custom")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.generatedBy").value("HUMAN"))
                .andExpect(jsonPath("$.data.segments.length()").value(1))
                .andReturn();
        UUID proposalId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].id").value(proposalId.toString()));
    }

    @Test
    void createCustomProposal_asClient_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-custom-client@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        // register client separately
        var reg = objectMapper.createObjectNode();
        reg.put("email", "client-custom@transflow.com");
        reg.put("password", "Password123!");
        reg.put("fullName", "Client");
        MvcResult clientReg = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reg)))
                .andExpect(status().isCreated()).andReturn();
        JsonNode clientData = objectMapper.readTree(clientReg.getResponse().getContentAsString()).path("data");
        String clientToken = clientData.path("accessToken").asText();
        UUID clientUserId = UUID.fromString(clientData.path("user").path("id").asText());
        addWorkspaceMember(lead.workspaceId(), clientUserId, Role.CLIENT);
        addProjectMember(lead.projectId(), clientUserId, lead.userId());

        var body = objectMapper.createObjectNode();
        body.putArray("segments").addObject().put("startMs", 0).put("endMs", 1000);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/custom")
                        .header("Authorization", "Bearer " + clientToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHORIZED.getCode()));
    }

    @Test
    void updateCustomProposal_changesSegmentsAndReasoning() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-update-custom@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        var createBody = objectMapper.createObjectNode();
        createBody.putArray("segments").addObject().put("startMs", 0).put("endMs", 10000);
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/custom")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createBody)))
                .andExpect(status().isCreated()).andReturn();
        UUID proposalId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());

        var updateBody = objectMapper.createObjectNode();
        updateBody.putArray("segments")
                .addObject().put("startMs", 5000).put("endMs", 20000);
        updateBody.put("reasoningNote", "revised pick");

        mockMvc.perform(put("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/" + proposalId)
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateBody)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.reasoningNote").value("revised pick"))
                .andExpect(jsonPath("$.data.segments.length()").value(1))
                .andExpect(jsonPath("$.data.segments[0].startMs").value(5000));
    }

    // ---- select ----

    @Test
    void selectProposal_activeProposal_setsSelectedProposalOnJob() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-select@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        var body = objectMapper.createObjectNode();
        body.putArray("segments").addObject().put("startMs", 0).put("endMs", 10000);
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/custom")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated()).andReturn();
        UUID proposalId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId
                        + "/proposals/" + proposalId + "/select")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId)
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.selectedProposalId").value(proposalId.toString()));
    }

    // ---- refine ----

    @Test
    void refine_noExistingAiProposal_returns404() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-refine-404@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/refine")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"feedbackText\":\"make it punchier\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.RESOURCE_NOT_FOUND.getCode()));
    }

    @Test
    void refine_withExistingAiProposal_createsNewRoundAndArchivesOld() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-refine-ok@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        // Seed round-1 AI proposal directly (no "generate" endpoint — produced by the not-yet-built
        // stage executor in real usage; see Backend_Java_TaskSplit_MemberB.md §7.3).
        UUID summarizeStageId = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SUMMARIZE)
                .orElseThrow().getId();
        var round1 = new com.app.modules.summarization.entity.SummaryProposal();
        round1.setMediaJobStageId(summarizeStageId);
        round1.setGeneratedBy(com.app.modules.summarization.entity.SummaryProposal.GeneratedBy.AI);
        round1.setGenerationRound((short) 1);
        round1.setScriptContent("Original script content.");
        round1.setScriptLanguage("en");
        round1.setCreatedAt(Instant.now());
        round1 = summaryProposalRepository.save(round1);

        when(refineSessionStore.incrementAndGet(jobId)).thenReturn(1);
        when(aiClient.refineScript("Original script content.", "make it punchier", "en")).thenReturn(
                new SummaryAiClient.ScriptProposalResult(
                        "Punchier script content.", "en",
                        List.of(new SummaryAiClient.SegmentDraft(0, 60_000, null, List.of(), null)),
                        "punchier tone", new BigDecimal("0.8"), List.of("minor pacing risk")));

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/refine")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"feedbackText\":\"make it punchier\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generationRound").value(2))
                .andExpect(jsonPath("$.data.scriptContent").value("Punchier script content."))
                .andExpect(jsonPath("$.data.feedbackText").value("make it punchier"));

        var archived = summaryProposalRepository.findById(round1.getId()).orElseThrow();
        assertEquals(true, archived.getArchivedAt() != null);

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].generationRound").value(2));
    }

    @Test
    void refine_overSessionLimit_returns429() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-refine-limit@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);
        UUID summarizeStageId = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SUMMARIZE)
                .orElseThrow().getId();
        var round1 = new com.app.modules.summarization.entity.SummaryProposal();
        round1.setMediaJobStageId(summarizeStageId);
        round1.setGeneratedBy(com.app.modules.summarization.entity.SummaryProposal.GeneratedBy.AI);
        round1.setGenerationRound((short) 1);
        round1.setScriptContent("Original script content.");
        round1.setCreatedAt(Instant.now());
        summaryProposalRepository.save(round1);

        when(refineSessionStore.incrementAndGet(jobId)).thenReturn(6);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/refine")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"feedbackText\":\"again\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value(ErrorCode.REFINE_LIMIT_REACHED.getCode()));
    }

    // ---- summary-languages ----

    @Test
    void summaryLanguages_selectedProposalIsHuman_returnsValidationError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-sumlang-human@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);

        var body = objectMapper.createObjectNode();
        body.putArray("segments").addObject().put("startMs", 0).put("endMs", 10000);
        MvcResult created = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/custom")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated()).andReturn();
        UUID proposalId = UUID.fromString(objectMapper.readTree(created.getResponse().getContentAsString())
                .path("data").path("id").asText());
        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/" + proposalId + "/select")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/summary-languages")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetLang\":\"vi\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void summaryLanguages_selectedProposalIsAi_createsDerivedJobWithSkippedStages() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-sumlang-ai@transflow.com");
        UUID jobId = createSummaryJob(lead, 60);
        UUID summarizeStageId = mediaJobStageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SUMMARIZE)
                .orElseThrow().getId();
        var aiProposal = new com.app.modules.summarization.entity.SummaryProposal();
        aiProposal.setMediaJobStageId(summarizeStageId);
        aiProposal.setGeneratedBy(com.app.modules.summarization.entity.SummaryProposal.GeneratedBy.AI);
        aiProposal.setGenerationRound((short) 1);
        aiProposal.setScriptContent("Original script content.");
        aiProposal.setCreatedAt(Instant.now());
        aiProposal = summaryProposalRepository.save(aiProposal);
        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/proposals/" + aiProposal.getId() + "/select")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/summary-languages")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetLang\":\"vi\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.targetLang").value("vi"))
                .andExpect(jsonPath("$.data.sourceSummaryJobId").value(jobId.toString()))
                .andExpect(jsonPath("$.data.selectedProposalId").value(aiProposal.getId().toString()))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='SUMMARIZE')].status").value("SKIPPED"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='EXTRACT_AUDIO')].status").value("SKIPPED"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='TRANSLATE')].status").value("PENDING"))
                .andExpect(jsonPath("$.data.stages[?(@.stageName=='RENDER')].status").value("PENDING"));
    }
}
