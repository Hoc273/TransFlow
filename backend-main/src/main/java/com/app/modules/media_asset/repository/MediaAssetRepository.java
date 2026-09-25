package com.app.modules.media_asset.repository;

import com.app.modules.media_asset.entity.MediaAsset;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MediaAssetRepository extends JpaRepository<MediaAsset, UUID> {

    Optional<MediaAsset> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    List<MediaAsset> findByWorkspaceIdAndProjectIdAndAssetType(
            UUID workspaceId, UUID projectId, MediaAsset.AssetType assetType);

    /**
     * Retention: marks assets older than {@code cutoff} as purged, except {@code protectedIds}
     * (sources of jobs running right now). Never pass an empty collection (JPQL "not in ()").
     */
    @Modifying
    @Query("""
            update MediaAsset a set a.purgedAt = :now
            where a.purgedAt is null and a.createdAt < :cutoff and a.id not in :protectedIds
            """)
    int markPurged(@Param("cutoff") Instant cutoff, @Param("now") Instant now,
                   @Param("protectedIds") Collection<UUID> protectedIds);
}
