package com.app.modules.credit.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "credit_pricing_config")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class CreditPricingConfig {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(nullable = false, length = 50)
    private String capability;

    @Column(name = "provider_scope", length = 100)
    private String providerScope;

    @Column(name = "infra_coefficient_x", nullable = false, precision = 10, scale = 6)
    private BigDecimal infraCoefficientX;

    @Column(name = "token_coefficient_y", precision = 10, scale = 6)
    private BigDecimal tokenCoefficientY;

    @Column(name = "effective_from", nullable = false)
    private Instant effectiveFrom = Instant.now();

    @Column(name = "effective_to")
    private Instant effectiveTo;

    @Column(name = "created_by_user_id")
    private UUID createdByUserId;

    @Column(name = "change_reason", columnDefinition = "TEXT")
    private String changeReason;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
