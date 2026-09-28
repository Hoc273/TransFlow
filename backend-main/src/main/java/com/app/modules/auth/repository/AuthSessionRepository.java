package com.app.modules.auth.repository;

import com.app.modules.auth.entity.AuthSession;
import com.app.modules.auth.entity.AuthSessionRevokeReason;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface AuthSessionRepository extends JpaRepository<AuthSession, UUID> {

    /** Serialises concurrent refreshes of the same session (several tabs). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM AuthSession s WHERE s.id = :id")
    Optional<AuthSession> findByIdForUpdate(@Param("id") UUID id);

    @Modifying
    @Query("""
            UPDATE AuthSession s SET s.revokedAt = :now, s.revokedReason = :reason
            WHERE s.userId = :userId AND s.revokedAt IS NULL
            """)
    int revokeAllForUser(@Param("userId") UUID userId,
                         @Param("reason") AuthSessionRevokeReason reason,
                         @Param("now") Instant now);

    @Modifying
    @Query("""
            UPDATE AuthSession s SET s.revokedAt = :now, s.revokedReason = :reason
            WHERE s.userId = :userId AND s.revokedAt IS NULL AND s.id <> :keepId
            """)
    int revokeAllForUserExcept(@Param("userId") UUID userId,
                               @Param("keepId") UUID keepId,
                               @Param("reason") AuthSessionRevokeReason reason,
                               @Param("now") Instant now);

    @Modifying
    @Query("""
            DELETE FROM AuthSession s
            WHERE s.expiresAt < :cutoff OR s.revokedAt < :cutoff OR s.lastUsedAt < :idleCutoff
            """)
    int deleteStale(@Param("cutoff") Instant cutoff, @Param("idleCutoff") Instant idleCutoff);
}
