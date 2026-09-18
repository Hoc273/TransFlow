package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditPricingConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface CreditPricingConfigRepository extends JpaRepository<CreditPricingConfig, UUID> {

    @Query("SELECT c FROM CreditPricingConfig c WHERE c.capability = :capability " +
            "AND (:providerScope IS NULL OR c.providerScope = :providerScope) " +
            "AND c.effectiveTo IS NULL ORDER BY c.effectiveFrom DESC")
    List<CreditPricingConfig> findActivePricing(@Param("capability") String capability,
                                                @Param("providerScope") String providerScope);
}
