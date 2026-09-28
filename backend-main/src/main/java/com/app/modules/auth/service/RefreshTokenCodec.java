package com.app.modules.auth.service;

import com.app.common.config.AppProperties;
import io.jsonwebtoken.io.Decoders;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

/**
 * Refresh token = {@code <sessionId>.<generation>.<HMAC-SHA256(sessionId.generation)>}.
 * Deterministic, so the current token can be re-issued inside the rotation grace window
 * without storing it; unforgeable without the key, which is derived from the JWT secret
 * with a domain-separation label.
 */
@Component
public class RefreshTokenCodec {

    private static final String ALGORITHM = "HmacSHA256";
    private static final String KEY_LABEL = "transflow/refresh-session/v1";

    public record Decoded(UUID sessionId, int generation) {}

    private final SecretKeySpec key;

    public RefreshTokenCodec(AppProperties props) {
        byte[] jwtSecret = Decoders.BASE64.decode(props.jwt().secret());
        this.key = new SecretKeySpec(hmac(new SecretKeySpec(jwtSecret, ALGORITHM), KEY_LABEL), ALGORITHM);
    }

    public String encode(UUID sessionId, int generation) {
        String payload = sessionId + "." + generation;
        return payload + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(key, payload));
    }

    /** Empty when malformed or the signature does not match. */
    public Optional<Decoded> decode(String token) {
        if (token == null) {
            return Optional.empty();
        }
        int lastDot = token.lastIndexOf('.');
        int firstDot = token.indexOf('.');
        if (firstDot <= 0 || lastDot <= firstDot) {
            return Optional.empty();
        }
        String payload = token.substring(0, lastDot);
        byte[] presented;
        try {
            presented = Base64.getUrlDecoder().decode(token.substring(lastDot + 1));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        if (!MessageDigest.isEqual(presented, hmac(key, payload))) {
            return Optional.empty();
        }
        try {
            UUID sessionId = UUID.fromString(token.substring(0, firstDot));
            int generation = Integer.parseInt(token.substring(firstDot + 1, lastDot));
            return generation >= 1 ? Optional.of(new Decoded(sessionId, generation)) : Optional.empty();
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static byte[] hmac(SecretKeySpec key, String data) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(key);
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
