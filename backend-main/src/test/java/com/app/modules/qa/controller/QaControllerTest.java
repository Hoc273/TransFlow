package com.app.modules.qa.controller;

import com.app.testsupport.TestRegistration;

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
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.project.entity.ProjectMember;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.entity.QaIssueOverride;
import com.app.modules.qa.repository.QaIssueOverrideRepository;
import com.app.modules.qa.repository.QaIssueRepository;
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

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class QaControllerTest {

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
    @Autowired private QaIssueRepository qaIssueRepository;
    @Autowired private QaIssueOverrideRepository qaIssueOverrideRepository;

    @MockBean private MediaStorageService storageService;
    @MockBean private VideoDurationProbe durationProbe;

    @BeforeEach
    void setUpAndCleanDb() {
        qaIssueOverrideRepository.deleteAll();
        qaIssueRepository.deleteAll();
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

    private UUID createLocalizationJob(Lead lead, String accessToken) throws Exception {
        UUID assetId = uploadAndConsentAsset(lead);
        var body = objectMapper.createObjectNode();
        body.put("projectId", lead.projectId().toString());
        body.put("rootAssetId", assetId.toString());
        body.put("recipeId", "localization.full");
        body.put("processingMode", "TRANSLATE_ONLY");
        body.put("targetLang", "en");

        MvcResult result = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/jobs")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(objectMapper.readTree(result.getResponse().getContentAsString()).path("data").path("id").asText());
    }

    private UUID seedSubtitleSegment(UUID jobId) {
        SubtitleSegment segment = new SubtitleSegment();
        segment.setMediaJobId(jobId);
        segment.setSeq(1);
        segment.setContentSource(SubtitleSegment.ContentSource.TRANSLATED_ORIGINAL);
        segment.setTargetText("Hello");
        segment.setStartMs(0);
        segment.setEndMs(1000);
        return subtitleSegmentRepository.save(segment).getId();
    }

    private UUID seedQaIssue(UUID segmentId, String issueType, QaIssue.Severity severity, boolean resolved) {
        QaIssue issue = new QaIssue();
        issue.setSubtitleSegmentId(segmentId);
        issue.setIssueType(issueType);
        issue.setSeverity(severity);
        issue.setBlockingActions(List.of("BLOCK_PUBLISH"));
        issue.setCreatedAt(Instant.now());
        if (resolved) {
            issue.setResolvedAt(Instant.now());
        }
        return qaIssueRepository.save(issue).getId();
    }

    // ---- list ----

    @Test
    void listIssues_noFilter_returnsAll() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-list@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        seedQaIssue(segId, "translation_mismatch", QaIssue.Severity.MEDIUM, false);
        seedQaIssue(segId, "subtitle_overlap", QaIssue.Severity.CRITICAL, true);

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/qa-issues")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void listIssues_unresolvedFilter_excludesResolved() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-filter@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        seedQaIssue(segId, "translation_mismatch", QaIssue.Severity.MEDIUM, false);
        seedQaIssue(segId, "subtitle_overlap", QaIssue.Severity.CRITICAL, true);

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/qa-issues?resolved=false")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].issueType").value("translation_mismatch"));
    }

    @Test
    void listIssues_clientReadAccess_isAllowed() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-client-read@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        RegisteredUser client = registerPlainUser("client-qa-read@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/jobs/" + jobId + "/qa-issues")
                        .header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isOk());
    }

    // ---- override ----

    @Test
    void overrideIssue_neverOverridableCritical_isForbiddenEvenForLead() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-neveroverride@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        UUID issueId = seedQaIssue(segId, "subtitle_overlap", QaIssue.Severity.CRITICAL, false);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/qa-issues/" + issueId + "/override")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"acceptable risk here\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.OVERRIDE_NOT_ALLOWED.getCode()));
    }

    @Test
    void overrideIssue_reasonTooShort_returnsValidationError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-short-reason@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        UUID issueId = seedQaIssue(segId, "translation_mismatch", QaIssue.Severity.MEDIUM, false);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/qa-issues/" + issueId + "/override")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"short\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }

    @Test
    void overrideIssue_leadOnAnyJob_succeedsAndMarksResolved() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-override-ok@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        UUID issueId = seedQaIssue(segId, "translation_mismatch", QaIssue.Severity.HIGH, false);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/qa-issues/" + issueId + "/override")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"reviewed and accepted\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.reason").value("reviewed and accepted"))
                .andExpect(jsonPath("$.data.qaIssueId").value(issueId.toString()));

        QaIssue afterOverride = qaIssueRepository.findById(issueId).orElseThrow();
        org.junit.jupiter.api.Assertions.assertNotNull(afterOverride.getResolvedAt());
        org.junit.jupiter.api.Assertions.assertEquals(1, qaIssueOverrideRepository.count());
    }

    @Test
    void overrideIssue_memberNotJobCreator_isJobOwnershipRequired() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-member-notowner@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        UUID issueId = seedQaIssue(segId, "translation_mismatch", QaIssue.Severity.HIGH, false);

        RegisteredUser member = registerPlainUser("member-qa-notowner@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        addProjectMember(lead.projectId(), member.userId(), lead.userId());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/qa-issues/" + issueId + "/override")
                        .header("Authorization", "Bearer " + member.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"reviewed and accepted\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.JOB_OWNERSHIP_REQUIRED.getCode()));
    }

    @Test
    void overrideIssue_client_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-client-override@transflow.com");
        UUID jobId = createLocalizationJob(lead, lead.accessToken());
        UUID segId = seedSubtitleSegment(jobId);
        UUID issueId = seedQaIssue(segId, "translation_mismatch", QaIssue.Severity.HIGH, false);

        RegisteredUser client = registerPlainUser("client-qa-override@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/qa-issues/" + issueId + "/override")
                        .header("Authorization", "Bearer " + client.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"reviewed and accepted\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.JOB_OWNERSHIP_REQUIRED.getCode()));
    }

    @Test
    void overrideIssue_notFound_returns404() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-qa-404@transflow.com");

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/qa-issues/" + UUID.randomUUID() + "/override")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"reviewed and accepted\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.RESOURCE_NOT_FOUND.getCode()));
    }
}
