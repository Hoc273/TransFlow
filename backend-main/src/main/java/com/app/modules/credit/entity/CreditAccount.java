package com.app.modules.credit.entity;

import com.app.common.entity.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "credit_accounts")
@Getter
@Setter
public class CreditAccount extends BaseEntity {

    @Column(name = "user_id", nullable = false, unique = true)
    private UUID userId;

    @Column(nullable = false, precision = 14, scale = 4)
    private BigDecimal balance = BigDecimal.ZERO;
}
