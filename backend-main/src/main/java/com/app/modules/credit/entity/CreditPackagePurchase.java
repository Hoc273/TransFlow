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
@Table(name = "credit_package_purchases")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
public class CreditPackagePurchase {

    @Id
    @UuidGenerator
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "package_id", nullable = false)
    private UUID packageId;

    @Column(name = "credit_amount", nullable = false, precision = 14, scale = 4)
    private BigDecimal creditAmount;

    @Column(name = "price_paid", nullable = false, precision = 14, scale = 2)
    private BigDecimal pricePaid;

    @Column(name = "payment_reference")
    private String paymentReference;

    @CreatedDate
    @Column(name = "purchased_at", nullable = false, updatable = false)
    private Instant purchasedAt;
}
