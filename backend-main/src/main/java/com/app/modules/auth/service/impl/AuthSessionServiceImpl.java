package com.app.modules.auth.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.entity.AuthSession;
import com.app.modules.auth.entity.AuthSessionRevokeReason;
import com.app.modules.auth.repository.AuthSessionRepository;
import com.app.modules.auth.service.AuthSessionService;
import com.app.modules.auth.service.RefreshTokenCodec;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class AuthSessionServiceImpl implements AuthSessionService {

    private static final Logger log = LoggerFactory.getLogger(AuthSessionServiceImpl.class);

    /**
     * How long the previous generation stays valid after a rotation. Covers several tabs
     * refreshing with the same cookie at once: the loser gets the winner's token back.
     */
    static final Duration ROTATION_GRACE = Duration.ofSeconds(30);
    /** Revoked / expired rows are kept this long for audit before the cleanup job drops them. */
    private static final Duration RETAIN_AFTER_END = Duration.ofDays(7);

    private final AuthSessionRepository repository;
    private final RefreshTokenCodec codec;
    private final Duration idleTimeout;
    private final Duration maxLifetime;
    private final Clock clock;

    @Autowired
    public AuthSessionServiceImpl(AuthSessionRepository repository, RefreshTokenCodec codec, AppProperties props) {
        this(repository, codec, props, Clock.systemUTC());
    }

    AuthSessionServiceImpl(AuthSessionRepository repository, RefreshTokenCodec codec, AppProperties props, Clock clock) {
        this.repository = repository;
        this.codec = codec;
        this.idleTimeout = Duration.ofDays(props.jwt().refreshTtlDays());
        this.maxLifetime = Duration.ofDays(props.jwt().sessionMaxDays());
        this.clock = clock;
    }

    @Override
    @Transactional
    public String open(UUID userId) {
        Instant now = clock.instant();
        AuthSession session = new AuthSession();
        session.setUserId(userId);
        session.setGeneration(1);
        session.setLastUsedAt(now);
        session.setExpiresAt(now.plus(maxLifetime));
        HttpServletRequest request = currentRequest();
        if (request != null) {
            session.setUserAgent(truncate(request.getHeader("User-Agent"), 512));
            session.setIpAddress(truncate(request.getRemoteAddr(), 64));
        }
        repository.saveAndFlush(session);
        return codec.encode(session.getId(), session.getGeneration());
    }

    /** noRollbackFor: a replay must stay revoked even though the call ends in an exception. */
    @Override
    @Transactional(noRollbackFor = AppException.class)
    public Rotation rotate(String refreshToken) {
        RefreshTokenCodec.Decoded decoded = codec.decode(refreshToken)
                .orElseThrow(() -> new AppException(ErrorCode.INVALID_REFRESH_TOKEN));
        AuthSession session = repository.findByIdForUpdate(decoded.sessionId())
                .orElseThrow(() -> new AppException(ErrorCode.INVALID_REFRESH_TOKEN));

        Instant now = clock.instant();
        if (session.getRevokedAt() != null
                || !now.isBefore(session.getExpiresAt())
                || !now.isBefore(session.getLastUsedAt().plus(idleTimeout))) {
            throw new AppException(ErrorCode.INVALID_REFRESH_TOKEN);
        }

        int current = session.getGeneration();
        if (decoded.generation() == current) {
            session.setGeneration(current + 1);
            session.setRotatedAt(now);
            session.setLastUsedAt(now);
        } else if (decoded.generation() == current - 1
                && session.getRotatedAt() != null
                && now.isBefore(session.getRotatedAt().plus(ROTATION_GRACE))) {
            // Concurrent refresh that lost the race: hand back the winner's token, no new rotation.
            session.setLastUsedAt(now);
        } else {
            session.setRevokedAt(now);
            session.setRevokedReason(AuthSessionRevokeReason.TOKEN_REUSE);
            log.warn("Refresh token replay detected; revoked session {} of user {}", session.getId(), session.getUserId());
            throw new AppException(ErrorCode.INVALID_REFRESH_TOKEN);
        }
        return new Rotation(session.getId(), session.getUserId(),
                codec.encode(session.getId(), session.getGeneration()));
    }

    @Override
    @Transactional
    public void revoke(String refreshToken) {
        codec.decode(refreshToken).ifPresent(d -> revokeSession(d.sessionId(), AuthSessionRevokeReason.LOGOUT));
    }

    @Override
    @Transactional
    public void revokeSession(UUID sessionId, AuthSessionRevokeReason reason) {
        repository.findByIdForUpdate(sessionId).ifPresent(session -> {
            if (session.getRevokedAt() == null) {
                session.setRevokedAt(clock.instant());
                session.setRevokedReason(reason);
            }
        });
    }

    @Override
    @Transactional
    public void revokeOthers(UUID userId, String currentRefreshToken, AuthSessionRevokeReason reason) {
        UUID keep = codec.decode(currentRefreshToken)
                .map(RefreshTokenCodec.Decoded::sessionId)
                .flatMap(repository::findById)
                .filter(s -> s.getUserId().equals(userId))
                .map(AuthSession::getId)
                .orElse(null);
        if (keep == null) {
            repository.revokeAllForUser(userId, reason, clock.instant());
        } else {
            repository.revokeAllForUserExcept(userId, keep, reason, clock.instant());
        }
    }

    @Override
    @Transactional
    public void revokeAll(UUID userId, AuthSessionRevokeReason reason) {
        repository.revokeAllForUser(userId, reason, clock.instant());
    }

    @Scheduled(cron = "${app.maintenance.auth-session-cleanup-cron:0 40 3 * * *}")
    @Transactional
    public void deleteStaleSessions() {
        Instant now = clock.instant();
        Instant cutoff = now.minus(RETAIN_AFTER_END);
        int deleted = repository.deleteStale(cutoff, cutoff.minus(idleTimeout));
        if (deleted > 0) {
            log.info("Deleted {} ended auth sessions", deleted);
        }
    }

    private static HttpServletRequest currentRequest() {
        return RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs
                ? attrs.getRequest()
                : null;
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
