package com.app.modules.media_asset.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.entity.MediaConsent;
import com.app.modules.media_asset.entity.TermsVersion;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.repository.MediaConsentRepository;
import com.app.modules.media_asset.repository.TermsVersionRepository;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_asset.service.VideoDurationProbe;
import com.app.modules.workspace.service.WorkspaceAccessService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
public class MediaAssetServiceImpl implements MediaAssetService {

    static final long MAX_FILE_SIZE_BYTES = 524_288_000L; // 500MB (SRS §6)
    private static final long MAX_DURATION_MS = 1_800_000L; // 30 phút (SRS §6)
    private static final int MAX_FILE_NAME_LENGTH = 255;

    private final MediaAssetRepository mediaAssetRepository;
    private final MediaConsentRepository mediaConsentRepository;
    private final TermsVersionRepository termsVersionRepository;
    private final MediaStorageService storageService;
    private final VideoDurationProbe durationProbe;
    private final WorkspaceAccessService access;

    public MediaAssetServiceImpl(MediaAssetRepository mediaAssetRepository,
                                  MediaConsentRepository mediaConsentRepository,
                                  TermsVersionRepository termsVersionRepository,
                                  MediaStorageService storageService,
                                  VideoDurationProbe durationProbe,
                                  WorkspaceAccessService access) {
        this.mediaAssetRepository = mediaAssetRepository;
        this.mediaConsentRepository = mediaConsentRepository;
        this.termsVersionRepository = termsVersionRepository;
        this.storageService = storageService;
        this.durationProbe = durationProbe;
        this.access = access;
    }

    @Override
    @Transactional
    public MediaAsset upload(UUID workspaceId, UUID userId, UUID projectId, MultipartFile file, String name) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);

        if (file == null || file.isEmpty()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (file.getSize() > MAX_FILE_SIZE_BYTES) {
            throw new AppException(ErrorCode.MEDIA_FILE_TOO_LARGE);
        }

        String contentType = file.getContentType();
        requireVideoContentType(contentType);
        String fileName = (name != null && !name.isBlank()) ? name : file.getOriginalFilename();
        Path tempFile = null;
        try {
            tempFile = Files.createTempFile("media_upload_", "_" + UUID.randomUUID());
            file.transferTo(tempFile);
            return storeSourceAsset(workspaceId, userId, projectId, tempFile, file.getSize(), contentType, fileName);
        } catch (IOException ex) {
            log.error("Failed to store uploaded video: {}", ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException ignored) {
                    // best effort cleanup
                }
            }
        }
    }

    @Override
    @Transactional
    public MediaAsset createSourceAsset(UUID workspaceId, UUID userId, UUID projectId, Path videoFile,
                                        long sizeBytes, String contentType, String fileName) {
        // Re-checked at completion: membership may have changed while the chunks were uploading.
        access.requireProjectWriteAccess(workspaceId, userId, projectId);
        return storeSourceAsset(workspaceId, userId, projectId, videoFile, sizeBytes, contentType, fileName);
    }

    private MediaAsset storeSourceAsset(UUID workspaceId, UUID userId, UUID projectId, Path videoFile,
                                        long sizeBytes, String contentType, String fileName) {
        if (sizeBytes > MAX_FILE_SIZE_BYTES) {
            throw new AppException(ErrorCode.MEDIA_FILE_TOO_LARGE);
        }
        requireVideoContentType(contentType);

        Long durationMs = durationProbe.extractDurationMs(videoFile);
        if ((durationMs == null || durationMs <= 0) && durationProbe.isAvailable()) {
            // ffprobe ran but found no decodable media (renamed .exe, HTML, zip, ...): never store it.
            throw new AppException(ErrorCode.MEDIA_INVALID_FILE);
        }
        if (durationMs != null && durationMs > MAX_DURATION_MS) {
            throw new AppException(ErrorCode.MEDIA_DURATION_EXCEEDED);
        }

        String objectKey = "source/" + UUID.randomUUID();
        try (var stream = Files.newInputStream(videoFile)) {
            storageService.putMediaObject(objectKey, stream, sizeBytes, contentType);
        } catch (IOException ex) {
            log.error("Failed to store uploaded video: {}", ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }

        MediaAsset asset = new MediaAsset();
        asset.setWorkspaceId(workspaceId);
        asset.setProjectId(projectId);
        asset.setAssetType(MediaAsset.AssetType.SOURCE_VIDEO);
        asset.setStorageProvider(storageService.providerName());
        asset.setBucketName(storageService.mediaBucket());
        asset.setObjectStorageKey(objectKey);
        asset.setFileName(sanitizeFileName(fileName));
        asset.setMimeType(contentType);
        asset.setFileSizeBytes(sizeBytes);
        asset.setDurationMs(durationMs);
        asset.setUploadedByUserId(userId);
        asset.setProcessingStatus(MediaAsset.AssetStatus.READY);
        return mediaAssetRepository.save(asset);
    }

    /** Client-declared type is only a first filter; ffprobe is the real content check. */
    static void requireVideoContentType(String contentType) {
        if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("video/")) {
            throw new AppException(ErrorCode.MEDIA_INVALID_FILE);
        }
    }

    /** Display name only (the object key is a random UUID): strip path parts and control chars, cap length. */
    static String sanitizeFileName(String raw) {
        if (raw == null) {
            return "video";
        }
        String base = raw.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        base = base.replaceAll("[\\p{Cntrl}<>:\"|?*]", "_").trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) {
            return "video";
        }
        return base.length() > MAX_FILE_NAME_LENGTH ? base.substring(0, MAX_FILE_NAME_LENGTH) : base;
    }

    @Override
    @Transactional(readOnly = true)
    public List<MediaAsset> listRootAssets(UUID workspaceId, UUID userId, UUID projectId) {
        access.requireProjectAccess(workspaceId, userId, projectId);
        return mediaAssetRepository.findByWorkspaceIdAndProjectIdAndAssetType(
                workspaceId, projectId, MediaAsset.AssetType.SOURCE_VIDEO);
    }

    @Override
    @Transactional(readOnly = true)
    public MediaAsset getAsset(UUID workspaceId, UUID userId, UUID assetId) {
        MediaAsset asset = mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        access.requireProjectAccess(workspaceId, userId, asset.getProjectId());
        return asset;
    }

    @Override
    @Transactional(readOnly = true)
    public String currentTermsVersion() {
        return termsVersionRepository.findByCurrentTrue()
                .map(TermsVersion::getVersion)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
    }

    @Override
    @Transactional
    public MediaConsent consent(UUID workspaceId, UUID userId, UUID assetId, String termsVersion) {
        MediaAsset asset = mediaAssetRepository.findByIdAndWorkspaceId(assetId, workspaceId)
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        access.requireProjectWriteAccess(workspaceId, userId, asset.getProjectId());

        if (asset.getParentAssetId() != null) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        String trimmedVersion = termsVersion != null ? termsVersion.trim() : "";
        if (!trimmedVersion.equals(currentTermsVersion())) {
            throw new AppException(ErrorCode.TERMS_VERSION_MISMATCH);
        }

        return mediaConsentRepository.findByRootAssetIdAndTermsVersion(assetId, trimmedVersion)
                .orElseGet(() -> {
                    MediaConsent consent = new MediaConsent();
                    consent.setWorkspaceId(workspaceId);
                    consent.setRootAssetId(assetId);
                    consent.setUserId(userId);
                    consent.setTermsVersion(trimmedVersion);
                    consent.setConsentedAt(Instant.now());
                    return mediaConsentRepository.save(consent);
                });
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasCurrentConsent(UUID rootAssetId) {
        return mediaConsentRepository.existsByRootAssetIdAndTermsVersion(rootAssetId, currentTermsVersion());
    }
}
