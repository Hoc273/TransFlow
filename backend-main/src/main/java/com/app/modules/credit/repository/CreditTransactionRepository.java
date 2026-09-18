package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditTransaction;
import com.app.modules.credit.entity.CreditTransactionType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface CreditTransactionRepository extends JpaRepository<CreditTransaction, UUID> {

    List<CreditTransaction> findByUserIdOrderByCreatedAtDesc(UUID userId);

    @Query("SELECT ct FROM CreditTransaction ct WHERE (ct.userId = :userId OR ct.performedByUserId = :userId) " +
            "AND (:type IS NULL OR ct.type = :type) " +
            "AND (cast(:from as timestamp) IS NULL OR ct.createdAt >= :from) " +
            "AND (cast(:to as timestamp) IS NULL OR ct.createdAt <= :to) " +
            "ORDER BY ct.createdAt DESC")
    Page<CreditTransaction> findUserTransactions(
            @Param("userId") UUID userId,
            @Param("type") CreditTransactionType type,
            @Param("from") Instant from,
            @Param("to") Instant to,
            Pageable pageable
    );
}
