package com.app.modules.credit.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "credit_transactions")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class CreditTransaction {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, precision = 14, scale = 4)
    private BigDecimal amount;

    @Column(name = "balance_after", nullable = false, precision = 14, scale = 4)
    private BigDecimal balanceAfter;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private CreditTransactionType type;

    @Column(name = "performed_by_user_id")
    private UUID performedByUserId;

    @Column(name = "ref_type")
    private String refType;

    @Column(name = "ref_id")
    private UUID refId;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
