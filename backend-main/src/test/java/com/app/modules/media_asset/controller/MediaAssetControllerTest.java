package com.app.modules.media_asset.controller;

import com.app.testsupport.TestRegistration;

import com.app.common.exception.ErrorCode;
import com.app.modules.auth.dto.RegisterRequest;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.entity.TermsVersion;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.repository.MediaConsentRepository;
import com.app.modules.media_asset.repository.TermsVersionRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_asset.service.VideoDurationProbe;
import com.app.modules.project.entity.ProjectMember;
import com.app.modules.project.repository.ProjectMemberRepository;
import com.app.modules.project.repository.ProjectRepository;
import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.WorkspaceMember;
import com.app.modules.workspace.repository.WorkspaceMemberRepository;
import com.app.modules.workspace.repository.WorkspaceRepository;
import com.app.modules.credit.repository.CreditAccountRepository;
import com.app.modules.credit.repository.CreditTransactionRepository;
import com.app.modules.credit.repository.WorkspaceBillingConfigRepository;
import com.app.modules.auth.repository.UserRepository;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.MockMvc;

import org.springframework.test.web.servlet.ResultActions;

import java.io.InputStream;
import java.time.Instant;
import java.util.Arrays;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class MediaAssetControllerTest {

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

    // Real MinIO/ffprobe are not available in tests — stub the collaborators the
    // controller depends on transitively through MediaAssetServiceImpl.
    @MockBean
    private MediaStorageService storageService;
    @MockBean
    private VideoDurationProbe durationProbe;

    @BeforeEach
    void setUpAndCleanDb() {
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

        // Tests run with flyway disabled (ddl-auto=create-drop) — seed the current
        // terms version normally seeded by V2__init_indexes.sql in real environments.
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

    private record RegisteredUser(String accessToken, UUID userId) {
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

    private RegisteredUser registerPlainUser(String email) throws Exception {
        RegisterRequest req = TestRegistration.withOtp(registerOtpStore, new RegisterRequest(email, "Password123!", "User " + email));
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return new RegisteredUser(data.path("accessToken").asText(),
                UUID.fromString(data.path("user").path("id").asText()));
    }

    /** Adds userId to leadWorkspaceId with the given role (no separate workspace/project of its own is used). */
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

    private MockMultipartFile videoFile() {
        return new MockMultipartFile("file", "clip.mp4", "video/mp4", "fake-video-bytes".getBytes());
    }

    // ---- Chunked upload (chunk-size-bytes = 1024 in the test profile) ----

    private String startUpload(Lead lead, long size) throws Exception {
        MvcResult res = mockMvc.perform(post("/api/workspaces/{ws}/projects/{p}/media/uploads", lead.workspaceId(), lead.projectId())
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"clip.mp4\",\"fileSizeBytes\":" + size + ",\"contentType\":\"video/mp4\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.chunkSizeBytes").value(1024))
                .andExpect(jsonPath("$.data.totalChunks").value((size + 1023) / 1024))
                .andExpect(jsonPath("$.data.receivedChunks").value(0))
                .andReturn();
        return objectMapper.readTree(res.getResponse().getContentAsString()).path("data").path("uploadId").asText();
    }

    private ResultActions putChunk(String token, UUID ws, String uploadId, int index, byte[] bytes) throws Exception {
        return mockMvc.perform(put("/api/workspaces/{ws}/media/uploads/{id}/chunks/{i}", ws, uploadId, index)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .content(bytes));
    }

    private ResultActions completeUpload(Lead lead, String uploadId) throws Exception {
        return mockMvc.perform(post("/api/workspaces/{ws}/media/uploads/{id}/complete", lead.workspaceId(), uploadId)
                .header("Authorization", "Bearer " + lead.accessToken()));
    }

    @Test
    void chunkedUpload_outOfOrderChunksAssembleIntoTheStoredVideo() throws Exception {
        Lead lead = registerLeadWithWorkspace("chunk-lead@transflow.com");
        byte[] video = new byte[2500];
        new Random(7).nextBytes(video);
        String uploadId = startUpload(lead, video.length);

        AtomicReference<byte[]> stored = new AtomicReference<>();
        doAnswer(inv -> {
            stored.set(inv.<InputStream>getArgument(1).readAllBytes());
            return null;
        }).when(storageService).putMediaObject(any(), any(), anyLong(), any());

        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 2, Arrays.copyOfRange(video, 2048, 2500))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.receivedChunks").value(1));
        // Completing early is refused.
        completeUpload(lead, uploadId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(ErrorCode.UPLOAD_INCOMPLETE.getCode()));
        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 0, Arrays.copyOfRange(video, 0, 1024))
                .andExpect(status().isOk());
        // Re-sending a chunk (lost response) is harmless.
        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 0, Arrays.copyOfRange(video, 0, 1024))
                .andExpect(status().isOk());
        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 1, Arrays.copyOfRange(video, 1024, 2048))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.receivedChunks").value(3));

        MvcResult done = mockMvc.perform(post("/api/workspaces/{ws}/media/uploads/{id}/complete", lead.workspaceId(), uploadId)
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"My clip.mp4\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.fileName").value("My clip.mp4"))
                .andExpect(jsonPath("$.data.fileSizeBytes").value(2500))
                .andExpect(jsonPath("$.data.processingStatus").value("READY"))
                .andReturn();
        assertArrayEquals(video, stored.get());

        // Retried complete (lost response) returns the same asset instead of storing twice.
        String assetId = objectMapper.readTree(done.getResponse().getContentAsString()).path("data").path("id").asText();
        completeUpload(lead, uploadId)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.id").value(assetId));
        assertEquals(1, mediaAssetRepository.count());
    }

    @Test
    void chunkedUpload_rejectsWrongChunkSizeAndForeignUsers() throws Exception {
        Lead lead = registerLeadWithWorkspace("chunk-owner@transflow.com");
        Lead other = registerLeadWithWorkspace("chunk-other@transflow.com");
        String uploadId = startUpload(lead, 2048);

        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 0, new byte[1000])
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.UPLOAD_CHUNK_INVALID.getCode()));
        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 2, new byte[1024])
                .andExpect(status().isBadRequest());
        // Another user cannot see or write the session, even with its id.
        putChunk(other.accessToken(), other.workspaceId(), uploadId, 0, new byte[1024])
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.UPLOAD_SESSION_NOT_FOUND.getCode()));

        mockMvc.perform(delete("/api/workspaces/{ws}/media/uploads/{id}", lead.workspaceId(), uploadId)
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk());
        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 0, new byte[1024])
                .andExpect(status().isNotFound());
    }

    @Test
    void chunkedUpload_invalidVideoIsRejectedAndDiscarded() throws Exception {
        Lead lead = registerLeadWithWorkspace("chunk-bad@transflow.com");
        when(durationProbe.extractDurationMs(any())).thenReturn(null);
        when(durationProbe.isAvailable()).thenReturn(true);
        String uploadId = startUpload(lead, 10);
        putChunk(lead.accessToken(), lead.workspaceId(), uploadId, 0, new byte[10]).andExpect(status().isOk());

        completeUpload(lead, uploadId)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.MEDIA_INVALID_FILE.getCode()));
        completeUpload(lead, uploadId).andExpect(status().isNotFound());
    }

    @Test
    void chunkedUpload_startEnforcesSizeTypeAndRole() throws Exception {
        Lead lead = registerLeadWithWorkspace("chunk-limits@transflow.com");
        String base = "/api/workspaces/" + lead.workspaceId() + "/projects/" + lead.projectId() + "/media/uploads";

        mockMvc.perform(post(base).header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"big.mp4\",\"fileSizeBytes\":524288001,\"contentType\":\"video/mp4\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.MEDIA_FILE_TOO_LARGE.getCode()));
        mockMvc.perform(post(base).header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"a.zip\",\"fileSizeBytes\":10,\"contentType\":\"application/zip\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.MEDIA_INVALID_FILE.getCode()));

        RegisteredUser client = registerPlainUser("chunk-client@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());
        mockMvc.perform(post(base).header("Authorization", "Bearer " + client.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"c.mp4\",\"fileSizeBytes\":10,\"contentType\":\"video/mp4\"}"))
                .andExpect(status().isForbidden());
    }

    // ---- upload ----

    @Test
    void upload_asLead_succeedsAndReturnsReadyAsset() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-upload@transflow.com");

        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile())
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value(1000))
                .andExpect(jsonPath("$.data.assetType").value("SOURCE_VIDEO"))
                .andExpect(jsonPath("$.data.processingStatus").value("READY"))
                .andExpect(jsonPath("$.data.fileName").value("clip.mp4"))
                .andExpect(jsonPath("$.data.durationMs").value(90000))
                .andExpect(jsonPath("$.data.parentAssetId").doesNotExist());
    }

    @Test
    void upload_asMemberWithoutProjectAssignment_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-noassign@transflow.com");
        RegisteredUser member = registerPlainUser("member-noassign@transflow.com");
        addWorkspaceMember(lead.workspaceId(), member.userId(), Role.MEMBER);
        // Intentionally no project_members row.

        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile())
                        .header("Authorization", "Bearer " + member.accessToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHORIZED.getCode()));
    }

    @Test
    void upload_asClient_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-client@transflow.com");
        RegisteredUser client = registerPlainUser("client-upload@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);
        addProjectMember(lead.projectId(), client.userId(), lead.userId());

        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile())
                        .header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHORIZED.getCode()));
    }

    @Test
    void upload_durationExceeds30Minutes_returnsBusinessError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-duration@transflow.com");
        when(durationProbe.extractDurationMs(any())).thenReturn(1_800_001L);

        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile())
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.MEDIA_DURATION_EXCEEDED.getCode()));
    }

    @Test
    void upload_withoutAuthentication_isUnauthenticated() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-noauth@transflow.com");

        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHENTICATED.getCode()));
    }

    // ---- terms-version ----

    @Test
    void currentTermsVersion_asLead_returnsSeededVersion() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-terms@transflow.com");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/terms-version")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.termsVersion").value("v1"));
    }

    @Test
    void currentTermsVersion_asClient_isForbidden() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-terms-client@transflow.com");
        RegisteredUser client = registerPlainUser("client-terms@transflow.com");
        addWorkspaceMember(lead.workspaceId(), client.userId(), Role.CLIENT);

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/terms-version")
                        .header("Authorization", "Bearer " + client.accessToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(ErrorCode.UNAUTHORIZED.getCode()));
    }

    // ---- list / get ----

    @Test
    void listAssets_returnsUploadedRootAssetForProjectMembers() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-list@transflow.com");
        mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile())
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].fileName").value("clip.mp4"));
    }

    @Test
    void getAsset_notFound_returns404() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-notfound@transflow.com");

        mockMvc.perform(get("/api/workspaces/" + lead.workspaceId() + "/media/assets/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(ErrorCode.RESOURCE_NOT_FOUND.getCode()));
    }

    // ---- consent ----

    private UUID uploadAssetAs(Lead lead) throws Exception {
        MvcResult result = mockMvc.perform(multipart("/api/workspaces/" + lead.workspaceId()
                        + "/projects/" + lead.projectId() + "/media/assets")
                        .file(videoFile())
                        .header("Authorization", "Bearer " + lead.accessToken()))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode data = objectMapper.readTree(result.getResponse().getContentAsString()).path("data");
        return UUID.fromString(data.path("id").asText());
    }

    @Test
    void consent_withCurrentVersion_isCreated() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-consent@transflow.com");
        UUID assetId = uploadAssetAs(lead);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/assets/" + assetId + "/consent")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"v1\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.rootAssetId").value(assetId.toString()))
                .andExpect(jsonPath("$.data.termsVersion").value("v1"));
    }

    @Test
    void consent_calledTwice_isIdempotent() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-consent-idem@transflow.com");
        UUID assetId = uploadAssetAs(lead);

        MvcResult first = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId()
                        + "/media/assets/" + assetId + "/consent")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"v1\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String firstId = objectMapper.readTree(first.getResponse().getContentAsString()).path("data").path("id").asText();

        MvcResult second = mockMvc.perform(post("/api/workspaces/" + lead.workspaceId()
                        + "/media/assets/" + assetId + "/consent")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"v1\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String secondId = objectMapper.readTree(second.getResponse().getContentAsString()).path("data").path("id").asText();

        assertEquals(firstId, secondId);
        assertEquals(1, mediaConsentRepository.count());
    }

    @Test
    void consent_withMismatchedVersion_returnsBusinessError() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-consent-mismatch@transflow.com");
        UUID assetId = uploadAssetAs(lead);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId() + "/media/assets/" + assetId + "/consent")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"not-current\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.TERMS_VERSION_MISMATCH.getCode()));
    }

    @Test
    void consent_onDerivedAsset_isRejected() throws Exception {
        Lead lead = registerLeadWithWorkspace("lead-consent-derived@transflow.com");
        UUID rootAssetId = uploadAssetAs(lead);

        MediaAsset derived = new MediaAsset();
        derived.setWorkspaceId(lead.workspaceId());
        derived.setProjectId(lead.projectId());
        derived.setParentAssetId(rootAssetId);
        derived.setAssetType(MediaAsset.AssetType.EXTRACTED_AUDIO);
        derived.setStorageProvider("minio");
        derived.setBucketName("test-bucket");
        derived.setObjectStorageKey("derived/" + UUID.randomUUID());
        derived.setFileName("clip-audio.wav");
        derived.setMimeType("audio/wav");
        derived.setFileSizeBytes(10L);
        derived.setUploadedByUserId(lead.userId());
        derived.setProcessingStatus(MediaAsset.AssetStatus.READY);
        derived = mediaAssetRepository.save(derived);

        mockMvc.perform(post("/api/workspaces/" + lead.workspaceId()
                        + "/media/assets/" + derived.getId() + "/consent")
                        .header("Authorization", "Bearer " + lead.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"termsVersion\":\"v1\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(ErrorCode.VALIDATION_ERROR.getCode()));
    }
}
