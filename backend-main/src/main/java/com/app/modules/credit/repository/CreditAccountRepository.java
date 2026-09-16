package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditAccount;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface CreditAccountRepository extends JpaRepository<CreditAccount, UUID> {

    Optional<CreditAccount> findByUserId(UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT ca FROM CreditAccount ca WHERE ca.userId = :userId")
    Optional<CreditAccount> findByUserIdForUpdate(@Param("userId") UUID userId);
}
