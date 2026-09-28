package com.app.modules.auth.service;

import com.app.modules.auth.entity.AuthSessionRevokeReason;

import java.util.UUID;

/**
 * Stateful refresh sessions (V4__auth_sessions.sql): rotation with reuse detection,
 * revocation on logout / password change / password reset.
 */
public interface AuthSessionService {

    /** Starts a session for a fresh sign-in; returns its first refresh token. */
    String open(UUID userId);

    /**
     * Rotates the presented refresh token.
     *
     * @throws com.app.common.exception.AppException INVALID_REFRESH_TOKEN when unknown, expired,
     *         revoked or replayed (a replay also revokes the session)
     */
    Rotation rotate(String refreshToken);

    /** Logout: revokes the session behind this token; silently ignores invalid tokens. */
    void revoke(String refreshToken);

    void revokeSession(UUID sessionId, AuthSessionRevokeReason reason);

    /** Revokes every other session of the user; keeps the one behind {@code currentRefreshToken} if it belongs to them. */
    void revokeOthers(UUID userId, String currentRefreshToken, AuthSessionRevokeReason reason);

    void revokeAll(UUID userId, AuthSessionRevokeReason reason);

    record Rotation(UUID sessionId, UUID userId, String refreshToken) {}
}
