package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditPackagePurchase;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface CreditPackagePurchaseRepository extends JpaRepository<CreditPackagePurchase, UUID> {

    List<CreditPackagePurchase> findByUserIdOrderByPurchasedAtDesc(UUID userId);
}
