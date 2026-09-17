package com.app.modules.media_job.callback.util;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class HmacVerifierTest {

    private static final String SECRET = "test-secret";

    @Test
    void verify_validSignatureAndFreshTimestamp_doesNotThrow() {
        long ts = Instant.now().getEpochSecond();
        String body = "{\"jobId\":\"abc\"}";
        String sig = HmacVerifier.sign(SECRET, ts, body);

        assertDoesNotThrow(() -> HmacVerifier.verify(SECRET, body, ts, sig));
    }

    @Test
    void verify_wrongSecret_throwsUnauthenticated() {
        long ts = Instant.now().getEpochSecond();
        String body = "{\"jobId\":\"abc\"}";
        String sig = HmacVerifier.sign("other-secret", ts, body);

        AppException ex = assertThrows(AppException.class, () -> HmacVerifier.verify(SECRET, body, ts, sig));
        assertEquals(ErrorCode.UNAUTHENTICATED, ex.getErrorCode());
    }

    @Test
    void verify_tamperedBody_throwsUnauthenticated() {
        long ts = Instant.now().getEpochSecond();
        String sig = HmacVerifier.sign(SECRET, ts, "{\"jobId\":\"abc\"}");

        AppException ex = assertThrows(AppException.class, () ->
                HmacVerifier.verify(SECRET, "{\"jobId\":\"tampered\"}", ts, sig));
        assertEquals(ErrorCode.UNAUTHENTICATED, ex.getErrorCode());
    }

    @Test
    void verify_timestampTooOld_throwsUnauthenticated() {
        long ts = Instant.now().getEpochSecond() - 600; // 10 minutes ago, > ±5 min tolerance
        String body = "{\"jobId\":\"abc\"}";
        String sig = HmacVerifier.sign(SECRET, ts, body);

        AppException ex = assertThrows(AppException.class, () -> HmacVerifier.verify(SECRET, body, ts, sig));
        assertEquals(ErrorCode.UNAUTHENTICATED, ex.getErrorCode());
    }

    @Test
    void verify_timestampTooFarInFuture_throwsUnauthenticated() {
        long ts = Instant.now().getEpochSecond() + 600;
        String body = "{\"jobId\":\"abc\"}";
        String sig = HmacVerifier.sign(SECRET, ts, body);

        AppException ex = assertThrows(AppException.class, () -> HmacVerifier.verify(SECRET, body, ts, sig));
        assertEquals(ErrorCode.UNAUTHENTICATED, ex.getErrorCode());
    }

    @Test
    void verify_withinToleranceWindow_doesNotThrow() {
        long ts = Instant.now().getEpochSecond() - 250; // within ±5 min
        String body = "{\"jobId\":\"abc\"}";
        String sig = HmacVerifier.sign(SECRET, ts, body);

        assertDoesNotThrow(() -> HmacVerifier.verify(SECRET, body, ts, sig));
    }
}
