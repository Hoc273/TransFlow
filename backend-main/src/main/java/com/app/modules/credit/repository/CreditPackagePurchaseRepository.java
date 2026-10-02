package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditPackagePurchase;
import com.app.modules.credit.entity.CreditPurchaseStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CreditPackagePurchaseRepository extends JpaRepository<CreditPackagePurchase, UUID> {

    Page<CreditPackagePurchase> findByUserIdOrderByPurchasedAtDesc(UUID userId, Pageable pageable);

    @Query("SELECT p FROM CreditPackagePurchase p WHERE (:status IS NULL OR p.status = :status) ORDER BY p.purchasedAt DESC")
    Page<CreditPackagePurchase> findByStatus(@Param("status") CreditPurchaseStatus status, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM CreditPackagePurchase p WHERE p.id = :id")
    Optional<CreditPackagePurchase> findByIdForUpdate(@Param("id") UUID id);

    /** Mirrors the partial unique index ux_credit_package_purchases_reference_active (V8). */
    @Query("SELECT COUNT(p) > 0 FROM CreditPackagePurchase p "
            + "WHERE UPPER(p.paymentReference) = UPPER(:reference) AND p.status IN :statuses")
    boolean existsByReferenceInStatuses(@Param("reference") String reference,
                                        @Param("statuses") Collection<CreditPurchaseStatus> statuses);

    long countByUserIdAndStatus(UUID userId, CreditPurchaseStatus status);
}
