package com.app.modules.media_job.callback.util;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;

/**
 * HMAC-SHA256 verification for {@code /internal/media/**} callbacks (API_Contract.md §14).
 * Signed string is {@code "<timestamp>.<rawBody>"} — this exact format isn't spelled out byte-for-byte in
 * the docs, so it's this module's own reasonable choice (a la Stripe webhooks); confirm with
 * backend-media-worker's implementer before relying on it in production.
 */
public final class HmacVerifier {

    private static final String ALGORITHM = "HmacSHA256";
    private static final long TOLERANCE_SECONDS = 300; // API_Contract.md §14 — lệch quá ±5 phút bị từ chối

    private HmacVerifier() {
    }

    /** Throws {@code AppException(ErrorCode.UNAUTHENTICATED)} if the timestamp is stale or the signature is wrong. */
    public static void verify(String secret, String rawBody, long timestampEpochSeconds, String signatureHex) {
        long now = Instant.now().getEpochSecond();
        if (Math.abs(now - timestampEpochSeconds) > TOLERANCE_SECONDS) {
            throw new AppException(ErrorCode.UNAUTHENTICATED);
        }
        String expected = sign(secret, timestampEpochSeconds, rawBody);
        if (signatureHex == null || !MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                signatureHex.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8))) {
            throw new AppException(ErrorCode.UNAUTHENTICATED);
        }
    }

    public static String sign(String secret, long timestampEpochSeconds, String rawBody) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            byte[] signed = mac.doFinal((timestampEpochSeconds + "." + rawBody).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(signed);
        } catch (NoSuchAlgorithmException | java.security.InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
