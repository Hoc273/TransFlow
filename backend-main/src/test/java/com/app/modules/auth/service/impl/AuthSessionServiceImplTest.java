package com.app.modules.auth.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.auth.entity.AuthSession;
import com.app.modules.auth.entity.AuthSessionRevokeReason;
import com.app.modules.auth.repository.AuthSessionRepository;
import com.app.modules.auth.service.AuthSessionService;
import com.app.modules.auth.service.RefreshTokenCodec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class AuthSessionServiceImplTest {

    private static final String SECRET = "ZGV2LW9ubHktc2VjcmV0LWNoYW5nZS1tZS0zMi1ieXRlcy1sb25nISE=";

    private final Map<UUID, AuthSession> rows = new HashMap<>();
    private AuthSessionRepository repository;
    private RefreshTokenCodec codec;
    private MutableClock clock;
    private AuthSessionServiceImpl service;
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        repository = mock(AuthSessionRepository.class);
        when(repository.saveAndFlush(any())).thenAnswer(inv -> {
            AuthSession s = inv.getArgument(0);
            if (s.getId() == null) s.setId(UUID.randomUUID());
            rows.put(s.getId(), s);
            return s;
        });
        when(repository.findByIdForUpdate(any())).thenAnswer(inv -> Optional.ofNullable(rows.get(inv.<UUID>getArgument(0))));
        when(repository.findById(any())).thenAnswer(inv -> Optional.ofNullable(rows.get(inv.<UUID>getArgument(0))));

        AppProperties.Jwt jwt = new AppProperties.Jwt(SECRET, 30, 14, "transflow", 30);
        AppProperties props = mock(AppProperties.class);
        when(props.jwt()).thenReturn(jwt);
        codec = new RefreshTokenCodec(props);
        clock = new MutableClock(Instant.parse("2026-09-28T00:00:00Z"));
        service = new AuthSessionServiceImpl(repository, codec, props, clock);
    }

    @Test
    void rotationInvalidatesThePreviousTokenAfterTheGraceWindow() {
        String t1 = service.open(userId);
        AuthSessionService.Rotation r = service.rotate(t1);
        assertNotEquals(t1, r.refreshToken());
        assertEquals(userId, r.userId());

        clock.advance(Duration.ofSeconds(31));
        assertInvalid(() -> service.rotate(t1));

        // Replay revoked the whole session: even the latest token is now dead.
        AuthSession session = rows.get(r.sessionId());
        assertEquals(AuthSessionRevokeReason.TOKEN_REUSE, session.getRevokedReason());
        assertInvalid(() -> service.rotate(r.refreshToken()));
    }

    @Test
    void concurrentRefreshWithinGraceGetsTheSameNewToken() {
        String t1 = service.open(userId);
        String winner = service.rotate(t1).refreshToken();

        clock.advance(Duration.ofSeconds(5));
        String loser = service.rotate(t1).refreshToken();

        assertEquals(winner, loser);
        assertNull(rows.values().iterator().next().getRevokedAt());
        // The shared token keeps rotating normally.
        assertNotEquals(winner, service.rotate(winner).refreshToken());
    }

    @Test
    void tokenOlderThanThePreviousGenerationIsAReplayEvenInsideGrace() {
        String t1 = service.open(userId);
        String t2 = service.rotate(t1).refreshToken();
        service.rotate(t2);

        assertInvalid(() -> service.rotate(t1));
    }

    @Test
    void idleTimeoutAndAbsoluteLifetimeEndTheSession() {
        String idle = service.open(userId);
        clock.advance(Duration.ofDays(14));
        assertInvalid(() -> service.rotate(idle));

        String active = service.open(userId);
        for (int day = 0; day < 29; day++) {
            clock.advance(Duration.ofDays(1));
            active = service.rotate(active).refreshToken();
        }
        clock.advance(Duration.ofDays(1));
        String last = active;
        assertInvalid(() -> service.rotate(last));
    }

    @Test
    void forgedOrMalformedTokensAreRejectedWithoutDbLookup() {
        String t1 = service.open(userId);
        String forged = t1.substring(0, t1.lastIndexOf('.') + 1) + "AAAA";
        String bumped = t1.replaceFirst("\\.1\\.", ".2.");

        assertInvalid(() -> service.rotate(forged));
        assertInvalid(() -> service.rotate(bumped));
        assertInvalid(() -> service.rotate("garbage"));
        verify(repository, never()).findByIdForUpdate(any());
    }

    @Test
    void logoutRevokesOnlyThatSession() {
        String mine = service.open(userId);
        String other = service.open(userId);

        service.revoke(mine);

        assertInvalid(() -> service.rotate(mine));
        assertDoesNotThrow(() -> service.rotate(other));
    }

    @Test
    void revokeOthersKeepsTheCurrentSessionOfTheSameUser() {
        String mine = service.open(userId);
        UUID mineId = codec.decode(mine).orElseThrow().sessionId();

        service.revokeOthers(userId, mine, AuthSessionRevokeReason.PASSWORD_CHANGED);
        verify(repository).revokeAllForUserExcept(eq(userId), eq(mineId), eq(AuthSessionRevokeReason.PASSWORD_CHANGED), any());

        // A token of another user (or none) cannot shield a session: revoke all.
        String foreign = service.open(UUID.randomUUID());
        service.revokeOthers(userId, foreign, AuthSessionRevokeReason.PASSWORD_CHANGED);
        service.revokeOthers(userId, null, AuthSessionRevokeReason.PASSWORD_CHANGED);
        verify(repository, times(2)).revokeAllForUser(eq(userId), eq(AuthSessionRevokeReason.PASSWORD_CHANGED), any());
    }

    private static void assertInvalid(Runnable call) {
        AppException ex = assertThrows(AppException.class, call::run);
        assertEquals(ErrorCode.INVALID_REFRESH_TOKEN, ex.getErrorCode());
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }
}
