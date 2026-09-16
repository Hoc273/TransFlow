package com.app.modules.media_asset.entity;

import com.app.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

/**
 * Root or derived media object (Database_Design.md §6). Root assets
 * (parentAssetId == null, assetType == SOURCE_VIDEO) are the entry point for
 * Media Job creation — no {@code documents} table in transflow_mini.
 */
@Entity
@Table(name = "media_assets")
@Getter
@Setter
public class MediaAsset extends BaseEntity {

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "parent_asset_id")
    private UUID parentAssetId;

    @Enumerated(EnumType.STRING)
    @Column(name = "asset_type", nullable = false, length = 30)
    private AssetType assetType;

    @Column(name = "storage_provider", nullable = false, length = 30)
    private String storageProvider;

    @Column(name = "bucket_name", nullable = false, length = 120)
    private String bucketName;

    @Column(name = "object_storage_key", nullable = false, length = 1000)
    private String objectStorageKey;

    @Column(name = "file_name", nullable = false, length = 300)
    private String fileName;

    @Column(name = "mime_type", nullable = false, length = 150)
    private String mimeType;

    @Column(name = "file_size_bytes", nullable = false)
    private long fileSizeBytes;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "uploaded_by_user_id", nullable = false)
    private UUID uploadedByUserId;

    @Enumerated(EnumType.STRING)
    @Column(name = "processing_status", nullable = false, length = 20)
    private AssetStatus processingStatus = AssetStatus.UPLOADED;

    public enum AssetType {
        SOURCE_VIDEO,
        EXTRACTED_AUDIO,
        SEPARATED_STEM,
        DUBBED_AUDIO,
        MIXED_AUDIO,
        RENDERED_VIDEO,
        KEYFRAME_IMAGE
    }

    public enum AssetStatus {
        UPLOADED, VALIDATING, READY, FAILED
    }
}
