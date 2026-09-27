package com.app.modules.preset.entity;

import com.app.common.entity.BaseEntity;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.UUID;

/**
 * Media preset entity representing a reusable workflow/subtitle/voice/render configuration (Database_Design.md §9).
 * Scopes: SYSTEM (platform template), WORKSPACE (tenant default), PROJECT (project specific).
 */
@Entity
@Table(name = "media_presets")
@Getter
@Setter
public class MediaPreset extends BaseEntity {

    @Enumerated(EnumType.STRING)
    @Column(name = "scope", nullable = false)
    private MediaPresetScope scope;

    @Column(name = "workspace_id")
    private UUID workspaceId;

    @Column(name = "project_id")
    private UUID projectId;

    @Column(name = "name", nullable = false)
    private String name;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "subtitle_style", nullable = false)
    private JsonNode subtitleStyle;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "voice_config", nullable = false)
    private JsonNode voiceConfig;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "render_config", nullable = false)
    private JsonNode renderConfig;

    @Column(name = "is_default", nullable = false)
    private boolean isDefault = false;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "updated_by")
    private UUID updatedBy;
}
