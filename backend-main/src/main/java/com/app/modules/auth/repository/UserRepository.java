package com.app.modules.auth.repository;

import com.app.modules.auth.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    /** Alias-aware duplicate check — see {@code EmailNormalizer#canonicalize}. */
    boolean existsByEmailCanonical(String emailCanonical);

    Optional<User> findByGoogleSub(String googleSub);

    @Query("SELECT u FROM User u WHERE (:q IS NULL OR LOWER(u.email) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(u.fullName) LIKE LOWER(CONCAT('%', :q, '%'))) AND (:isAdmin IS NULL OR u.isPlatformAdmin = :isAdmin)")
    Page<User> searchAdmin(@Param("q") String q, @Param("isAdmin") Boolean isAdmin, Pageable pageable);

    long countByCreatedAtBetween(Instant from, Instant to);
}
