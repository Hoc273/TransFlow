package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditAccount;
import com.app.modules.credit.entity.CreditTransactionType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CreditAccountRepository extends JpaRepository<CreditAccount, UUID> {

    Optional<CreditAccount> findByUserId(UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT ca FROM CreditAccount ca WHERE ca.userId = :userId")
    Optional<CreditAccount> findByUserIdForUpdate(@Param("userId") UUID userId);

    /** One row per account with its ledger aggregates (credit monitor). */
    @Query("""
            SELECT ca.userId AS userId,
                   ca.balance AS balance,
                   COALESCE(SUM(t.amount), 0) AS ledgerBalance,
                   COALESCE(SUM(CASE WHEN t.amount > 0 AND t.type <> :initialGrant AND t.createdAt >= :since
                                     THEN t.amount ELSE 0 END), 0) AS creditedInWindow,
                   COALESCE(SUM(CASE WHEN t.type = :aiUsage AND t.createdAt >= :since
                                     THEN -t.amount ELSE 0 END), 0) AS usedInWindow,
                   MAX(t.createdAt) AS lastActivityAt
            FROM CreditAccount ca
            LEFT JOIN CreditTransaction t ON t.userId = ca.userId
            GROUP BY ca.userId, ca.balance
            """)
    List<AccountLedgerRow> aggregateLedgers(@Param("since") Instant since,
                                            @Param("initialGrant") CreditTransactionType initialGrant,
                                            @Param("aiUsage") CreditTransactionType aiUsage);

    interface AccountLedgerRow {
        UUID getUserId();
        BigDecimal getBalance();
        BigDecimal getLedgerBalance();
        BigDecimal getCreditedInWindow();
        BigDecimal getUsedInWindow();
        Instant getLastActivityAt();
    }
}
