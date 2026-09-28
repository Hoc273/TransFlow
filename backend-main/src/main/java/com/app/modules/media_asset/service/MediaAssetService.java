package com.app.modules.media_asset.service;

import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.entity.MediaConsent;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

/**
 * Media Asset & Consent (API_Contract.md §4, Database_Design.md §6).
 */
public interface MediaAssetService {

    MediaAsset upload(UUID workspaceId, UUID userId, UUID projectId, MultipartFile file, String name);

    /**
     * Validates a fully received video on local disk (size, type, ffprobe duration), stores it
     * and creates the root SOURCE_VIDEO asset. The caller owns and deletes {@code videoFile}.
     */
    MediaAsset createSourceAsset(UUID workspaceId, UUID userId, UUID projectId, java.nio.file.Path videoFile,
                                 long sizeBytes, String contentType, String fileName);

    List<MediaAsset> listRootAssets(UUID workspaceId, UUID userId, UUID projectId);

    MediaAsset getAsset(UUID workspaceId, UUID userId, UUID assetId);

    /** Current copyright terms version (terms_versions.is_current). */
    String currentTermsVersion();

    MediaConsent consent(UUID workspaceId, UUID userId, UUID assetId, String termsVersion);

    /** Whether {@code rootAssetId} has a media_consents row for the currently active terms version. */
    boolean hasCurrentConsent(UUID rootAssetId);
}
