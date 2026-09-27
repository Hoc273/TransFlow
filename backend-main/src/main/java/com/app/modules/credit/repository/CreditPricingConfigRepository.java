package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditPricingConfig;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CreditPricingConfigRepository extends JpaRepository<CreditPricingConfig, UUID> {

    /** Version of one scoped row in effect at {@code at} ({@code effective_from <= at < effective_to}). */
    @Query("SELECT c FROM CreditPricingConfig c WHERE c.capability = :capability " +
            "AND c.providerScope = :providerScope " +
            "AND c.effectiveFrom <= :at AND (c.effectiveTo IS NULL OR c.effectiveTo > :at) " +
            "ORDER BY c.effectiveFrom DESC")
    List<CreditPricingConfig> findEffectiveScoped(@Param("capability") String capability,
                                                  @Param("providerScope") String providerScope,
                                                  @Param("at") Instant at);

    /** Default ({@code provider_scope IS NULL}) version in effect at {@code at}. */
    @Query("SELECT c FROM CreditPricingConfig c WHERE c.capability = :capability " +
            "AND c.providerScope IS NULL " +
            "AND c.effectiveFrom <= :at AND (c.effectiveTo IS NULL OR c.effectiveTo > :at) " +
            "ORDER BY c.effectiveFrom DESC")
    List<CreditPricingConfig> findEffectiveDefault(@Param("capability") String capability,
                                                   @Param("at") Instant at);

    /**
     * Price for {@code capability} at {@code at}, most specific first (Credit_Coefficient_Calculation P4):
     * {@code protocol/model} → {@code protocol} → default row.
     */
    default Optional<CreditPricingConfig> resolve(String capability, String providerScope, Instant at) {
        if (providerScope != null && !providerScope.isBlank()) {
            List<CreditPricingConfig> exact = findEffectiveScoped(capability, providerScope, at);
            if (!exact.isEmpty()) {
                return Optional.of(exact.get(0));
            }
            int slash = providerScope.indexOf('/');
            if (slash > 0) {
                List<CreditPricingConfig> protocol = findEffectiveScoped(capability, providerScope.substring(0, slash), at);
                if (!protocol.isEmpty()) {
                    return Optional.of(protocol.get(0));
                }
            }
        }
        return findEffectiveDefault(capability, at).stream().findFirst();
    }

    /** The open (latest, {@code effective_to IS NULL}) version of one pair, row-locked for versioning. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM CreditPricingConfig c WHERE c.capability = :capability " +
            "AND ((:providerScope IS NULL AND c.providerScope IS NULL) OR c.providerScope = :providerScope) " +
            "AND c.effectiveTo IS NULL")
    List<CreditPricingConfig> findOpenForUpdate(@Param("capability") String capability,
                                                @Param("providerScope") String providerScope);

    /** Rows in effect now or scheduled for later (i.e. not yet closed before {@code now}). */
    @Query("SELECT c FROM CreditPricingConfig c WHERE c.effectiveTo IS NULL OR c.effectiveTo > :now " +
            "ORDER BY c.capability, c.providerScope, c.effectiveFrom")
    List<CreditPricingConfig> findCurrentAndScheduled(@Param("now") Instant now);

    @Query("SELECT c FROM CreditPricingConfig c WHERE (:capability IS NULL OR c.capability = :capability) " +
            "AND (:anyScope = TRUE OR (:providerScope IS NULL AND c.providerScope IS NULL) " +
            "     OR c.providerScope = :providerScope) " +
            "ORDER BY c.capability, c.providerScope, c.effectiveFrom DESC")
    List<CreditPricingConfig> findHistory(@Param("capability") String capability,
                                          @Param("providerScope") String providerScope,
                                          @Param("anyScope") boolean anyScope);
}
