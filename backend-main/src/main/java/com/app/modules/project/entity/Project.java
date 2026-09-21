package com.app.modules.project.entity;

import com.app.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "projects")
@Getter
@Setter
public class Project extends BaseEntity {

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(name = "source_lang", length = 20)
    private String sourceLang;

    @Column(name = "default_glossary_id")
    private UUID defaultGlossaryId;

    @Column(name = "tm_enabled", nullable = false)
    private Boolean tmEnabled = true;

    @Column(length = 80)
    private String domain;

    @Column(length = 80)
    private String tone;
}
