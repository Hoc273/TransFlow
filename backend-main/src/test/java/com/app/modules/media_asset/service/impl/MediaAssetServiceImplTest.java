package com.app.modules.media_asset.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.entity.MediaConsent;
import com.app.modules.media_asset.entity.TermsVersion;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.repository.MediaConsentRepository;
import com.app.modules.media_asset.repository.TermsVersionRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_asset.service.VideoDurationProbe;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MediaAssetServiceImplTest {

    @Mock
    private MediaAssetRepository mediaAssetRepository;
    @Mock
    private MediaConsentRepository mediaConsentRepository;
    @Mock
    private TermsVersionRepository termsVersionRepository;
    @Mock
    private MediaStorageService storageService;
    @Mock
    private VideoDurationProbe durationProbe;
    @Mock
    private WorkspaceAccessService access;

    private MediaAssetServiceImpl service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new MediaAssetServiceImpl(mediaAssetRepository, mediaConsentRepository,
                termsVersionRepository, storageService, durationProbe, access);
    }

    // ---- upload ----

    @Test
    void upload_success_savesReadyAssetWithStorageMetadata() {
        MultipartFile file = new MockMultipartFile("file", "clip.mp4", "video/mp4", "hello-video".getBytes());
        when(durationProbe.extractDurationMs(any(Path.class))).thenReturn(120_000L);
        when(storageService.providerName()).thenReturn("minio");
        when(storageService.mediaBucket()).thenReturn("test-bucket");
        when(mediaAssetRepository.save(any(MediaAsset.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaAsset saved = service.upload(workspaceId, userId, projectId, file, null);

        verify(access).requireProjectWriteAccess(workspaceId, userId, projectId);
        verify(storageService).putMediaObject(anyString(), any(), eq((long) "hello-video".getBytes().length), eq("video/mp4"));
        assertEquals(workspaceId, saved.getWorkspaceId());
        assertEquals(projectId, saved.getProjectId());
        assertEquals(MediaAsset.AssetType.SOURCE_VIDEO, saved.getAssetType());
        assertEquals(MediaAsset.AssetStatus.READY, saved.getProcessingStatus());
        assertEquals("minio", saved.getStorageProvider());
        assertEquals("test-bucket", saved.getBucketName());
        assertEquals("clip.mp4", saved.getFileName());
        assertEquals("video/mp4", saved.getMimeType());
        assertEquals(120_000L, saved.getDurationMs());
        assertEquals(userId, saved.getUploadedByUserId());
    }

    @Test
    void upload_customName_overridesOriginalFilename() {
        MultipartFile file = new MockMultipartFile("file", "original.mp4", "video/mp4", "x".getBytes());
        when(durationProbe.extractDurationMs(any(Path.class))).thenReturn(1_000L);
        when(storageService.providerName()).thenReturn("minio");
        when(storageService.mediaBucket()).thenReturn("test-bucket");
        when(mediaAssetRepository.save(any(MediaAsset.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaAsset saved = service.upload(workspaceId, userId, projectId, file, "My Custom Name");

        assertEquals("My Custom Name", saved.getFileName());
    }

    @Test
    void upload_emptyFile_throwsValidationError() {
        MultipartFile file = new MockMultipartFile("file", "empty.mp4", "video/mp4", new byte[0]);

        AppException ex = assertThrows(AppException.class, () ->
                service.upload(workspaceId, userId, projectId, file, null));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verifyNoInteractions(mediaAssetRepository, storageService);
    }

    @Test
    void upload_fileExceeds500MB_throwsMediaFileTooLarge() {
        MultipartFile file = mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(524_288_001L); // 500MB + 1 byte

        AppException ex = assertThrows(AppException.class, () ->
                service.upload(workspaceId, userId, projectId, file, null));
        assertEquals(ErrorCode.MEDIA_FILE_TOO_LARGE, ex.getErrorCode());
        verifyNoInteractions(mediaAssetRepository, storageService);
    }

    @Test
    void upload_durationExceeds30Minutes_throwsMediaDurationExceeded() {
        MultipartFile file = new MockMultipartFile("file", "long.mp4", "video/mp4", "x".getBytes());
        when(durationProbe.extractDurationMs(any(Path.class))).thenReturn(1_800_001L);

        AppException ex = assertThrows(AppException.class, () ->
                service.upload(workspaceId, userId, projectId, file, null));
        assertEquals(ErrorCode.MEDIA_DURATION_EXCEEDED, ex.getErrorCode());
        verifyNoInteractions(mediaAssetRepository, storageService);
    }

    @Test
    void upload_unknownDuration_isAllowedThrough() {
        // ffprobe unavailable/undetermined -> null duration must not block upload (best-effort probe).
        MultipartFile file = new MockMultipartFile("file", "clip.mp4", "video/mp4", "x".getBytes());
        when(durationProbe.extractDurationMs(any(Path.class))).thenReturn(null);
        when(storageService.providerName()).thenReturn("minio");
        when(storageService.mediaBucket()).thenReturn("test-bucket");
        when(mediaAssetRepository.save(any(MediaAsset.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaAsset saved = service.upload(workspaceId, userId, projectId, file, null);

        assertNull(saved.getDurationMs());
    }

    // ---- listRootAssets ----

    @Test
    void listRootAssets_checksProjectAccessAndQueriesSourceVideosOnly() {
        MediaAsset asset = new MediaAsset();
        when(mediaAssetRepository.findByWorkspaceIdAndProjectIdAndAssetType(
                workspaceId, projectId, MediaAsset.AssetType.SOURCE_VIDEO))
                .thenReturn(List.of(asset));

        List<MediaAsset> result = service.listRootAssets(workspaceId, userId, projectId);

        verify(access).requireProjectAccess(workspaceId, userId, projectId);
        assertEquals(1, result.size());
    }

    // ---- getAsset ----

    @Test
    void getAsset_notFound_throwsResourceNotFound() {
        when(mediaAssetRepository.findByIdAndWorkspaceId(any(), eq(workspaceId))).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                service.getAsset(workspaceId, userId, UUID.randomUUID()));
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
        verifyNoInteractions(access);
    }

    @Test
    void getAsset_found_checksProjectAccessOfOwningProject() {
        UUID assetId = UUID.randomUUID();
        MediaAsset asset = new MediaAsset();
        asset.setProjectId(projectId);
        when(mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId)).thenReturn(Optional.of(asset));

        MediaAsset result = service.getAsset(workspaceId, userId, assetId);

        verify(access).requireProjectAccess(workspaceId, userId, projectId);
        assertSame(asset, result);
    }

    // ---- currentTermsVersion ----

    @Test
    void currentTermsVersion_returnsVersionMarkedCurrent() {
        TermsVersion tv = new TermsVersion();
        tv.setVersion("v1");
        tv.setCurrent(true);
        when(termsVersionRepository.findByCurrentTrue()).thenReturn(Optional.of(tv));

        assertEquals("v1", service.currentTermsVersion());
    }

    @Test
    void currentTermsVersion_noneCurrent_throwsResourceNotFound() {
        when(termsVersionRepository.findByCurrentTrue()).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () -> service.currentTermsVersion());
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
    }

    // ---- consent ----

    private MediaAsset rootAsset(UUID assetId) {
        MediaAsset asset = new MediaAsset();
        asset.setId(assetId);
        asset.setProjectId(projectId);
        asset.setParentAssetId(null);
        return asset;
    }

    private TermsVersion currentTerms(String version) {
        TermsVersion tv = new TermsVersion();
        tv.setVersion(version);
        tv.setCurrent(true);
        return tv;
    }

    @Test
    void consent_assetNotFound_throwsResourceNotFoundAndSkipsAccessCheck() {
        UUID assetId = UUID.randomUUID();
        when(mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId)).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                service.consent(workspaceId, userId, assetId, "v1"));
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
        verifyNoInteractions(access);
    }

    @Test
    void consent_derivedAsset_isRejected() {
        UUID assetId = UUID.randomUUID();
        MediaAsset derived = rootAsset(assetId);
        derived.setParentAssetId(UUID.randomUUID());
        when(mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId)).thenReturn(Optional.of(derived));

        AppException ex = assertThrows(AppException.class, () ->
                service.consent(workspaceId, userId, assetId, "v1"));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
        verify(access).requireProjectWriteAccess(workspaceId, userId, projectId);
    }

    @Test
    void consent_termsVersionMismatch_throwsTermsVersionMismatch() {
        UUID assetId = UUID.randomUUID();
        when(mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId))
                .thenReturn(Optional.of(rootAsset(assetId)));
        when(termsVersionRepository.findByCurrentTrue()).thenReturn(Optional.of(currentTerms("v1")));

        AppException ex = assertThrows(AppException.class, () ->
                service.consent(workspaceId, userId, assetId, "v0-outdated"));
        assertEquals(ErrorCode.TERMS_VERSION_MISMATCH, ex.getErrorCode());
        verify(mediaConsentRepository, never()).save(any());
    }

    @Test
    void consent_firstTime_createsNewConsentRecord() {
        UUID assetId = UUID.randomUUID();
        when(mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId))
                .thenReturn(Optional.of(rootAsset(assetId)));
        when(termsVersionRepository.findByCurrentTrue()).thenReturn(Optional.of(currentTerms("v1")));
        when(mediaConsentRepository.findByRootAssetIdAndTermsVersion(assetId, "v1")).thenReturn(Optional.empty());
        when(mediaConsentRepository.save(any(MediaConsent.class))).thenAnswer(inv -> inv.getArgument(0));

        MediaConsent consent = service.consent(workspaceId, userId, assetId, "v1");

        assertEquals(workspaceId, consent.getWorkspaceId());
        assertEquals(assetId, consent.getRootAssetId());
        assertEquals(userId, consent.getUserId());
        assertEquals("v1", consent.getTermsVersion());
        assertNotNull(consent.getConsentedAt());
        verify(mediaConsentRepository).save(any(MediaConsent.class));
    }

    @Test
    void consent_alreadyExists_isIdempotentAndDoesNotSaveAgain() {
        UUID assetId = UUID.randomUUID();
        MediaConsent existing = new MediaConsent();
        existing.setId(UUID.randomUUID());
        existing.setRootAssetId(assetId);
        existing.setTermsVersion("v1");

        when(mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId))
                .thenReturn(Optional.of(rootAsset(assetId)));
        when(termsVersionRepository.findByCurrentTrue()).thenReturn(Optional.of(currentTerms("v1")));
        when(mediaConsentRepository.findByRootAssetIdAndTermsVersion(assetId, "v1"))
                .thenReturn(Optional.of(existing));

        MediaConsent result = service.consent(workspaceId, userId, assetId, "v1");

        assertSame(existing, result);
        verify(mediaConsentRepository, never()).save(any());
    }
}
