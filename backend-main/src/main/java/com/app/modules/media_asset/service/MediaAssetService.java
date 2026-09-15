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

    List<MediaAsset> listRootAssets(UUID workspaceId, UUID userId, UUID projectId);

    MediaAsset getAsset(UUID workspaceId, UUID userId, UUID assetId);

    /** Current copyright terms version (terms_versions.is_current). */
    String currentTermsVersion();

    MediaConsent consent(UUID workspaceId, UUID userId, UUID assetId, String termsVersion);
}
