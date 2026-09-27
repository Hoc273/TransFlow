package com.app.modules.preset.repository;

import com.app.modules.preset.entity.MediaPreset;
import com.app.modules.preset.entity.MediaPresetScope;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface MediaPresetRepository extends JpaRepository<MediaPreset, UUID> {

    Optional<MediaPreset> findFirstByScopeAndIsDefaultTrueAndActiveTrue(MediaPresetScope scope);

    Optional<MediaPreset> findFirstByScopeAndWorkspaceIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope scope, UUID workspaceId);

    Optional<MediaPreset> findFirstByScopeAndProjectIdAndIsDefaultTrueAndActiveTrue(MediaPresetScope scope, UUID projectId);

    Optional<MediaPreset> findFirstByScopeAndIsDefaultTrue(MediaPresetScope scope);

    Optional<MediaPreset> findFirstByScopeAndWorkspaceIdAndIsDefaultTrue(MediaPresetScope scope, UUID workspaceId);

    Optional<MediaPreset> findFirstByScopeAndProjectIdAndIsDefaultTrue(MediaPresetScope scope, UUID projectId);

    List<MediaPreset> findByScopeAndActiveTrue(MediaPresetScope scope);

    List<MediaPreset> findByScopeAndActiveTrueOrderByNameAsc(MediaPresetScope scope);

    List<MediaPreset> findByScope(MediaPresetScope scope);

    List<MediaPreset> findByScopeAndWorkspaceId(MediaPresetScope scope, UUID workspaceId);

    List<MediaPreset> findByScopeAndProjectId(MediaPresetScope scope, UUID projectId);

    @Query("""
        SELECT p FROM MediaPreset p
        WHERE p.active = true AND (
            p.scope = com.app.modules.preset.entity.MediaPresetScope.SYSTEM
            OR (p.scope = com.app.modules.preset.entity.MediaPresetScope.WORKSPACE AND p.workspaceId = :workspaceId)
            OR (p.scope = com.app.modules.preset.entity.MediaPresetScope.PROJECT AND p.projectId IN :projectIds)
        )
    """)
    List<MediaPreset> findAvailablePresets(
            @Param("workspaceId") UUID workspaceId,
            @Param("projectIds") Collection<UUID> projectIds
    );

    @Query("""
        SELECT p FROM MediaPreset p
        WHERE p.active = true AND (
            p.scope = com.app.modules.preset.entity.MediaPresetScope.SYSTEM
            OR (p.scope = com.app.modules.preset.entity.MediaPresetScope.WORKSPACE AND p.workspaceId = :workspaceId)
        )
    """)
    List<MediaPreset> findAvailablePresetsNoProjects(
            @Param("workspaceId") UUID workspaceId
    );
}
