package com.app.modules.provider.repository;

import com.app.modules.provider.entity.UserAiProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserAiProviderRepository extends JpaRepository<UserAiProvider, UUID> {

    List<UserAiProvider> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Optional<UserAiProvider> findByIdAndUserId(UUID id, UUID userId);

    List<UserAiProvider> findByUserIdAndIsActiveTrue(UUID userId);

    /** Daily BYOK key check. */
    List<UserAiProvider> findByIsActiveTrue();
}
