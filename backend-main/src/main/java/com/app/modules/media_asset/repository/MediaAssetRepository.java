package com.app.modules.media_asset.repository;

import com.app.modules.media_asset.entity.MediaAsset;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MediaAssetRepository extends JpaRepository<MediaAsset, UUID> {

    Optional<MediaAsset> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    List<MediaAsset> findByWorkspaceIdAndProjectIdAndAssetType(
            UUID workspaceId, UUID projectId, MediaAsset.AssetType assetType);
}
