package com.app.modules.workspace.entity;

import com.app.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "workspaces")
@Getter
@Setter
public class Workspace extends BaseEntity {

    @Column(nullable = false, length = 200)
    private String name;

    @Column(nullable = false, length = 120)
    private String slug;

    @Column(name = "owner_user_id", nullable = false)
    private UUID ownerUserId;
}
