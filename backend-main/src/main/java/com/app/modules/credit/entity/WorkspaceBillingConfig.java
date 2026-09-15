package com.app.modules.credit.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workspace_billing_configs")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class WorkspaceBillingConfig {

    @Id
    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "cost_mode", nullable = false, length = 30)
    private CostMode costMode = CostMode.PAY_PER_USER;

    @Column(name = "configured_by")
    private UUID configuredBy;

    @LastModifiedDate
    @Column(name = "updated_at")
    private Instant updatedAt;
}
