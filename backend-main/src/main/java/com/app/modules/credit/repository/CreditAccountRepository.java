package com.app.modules.credit.repository;

import com.app.modules.credit.entity.CreditAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface CreditAccountRepository extends JpaRepository<CreditAccount, UUID> {

    Optional<CreditAccount> findByUserId(UUID userId);
}
