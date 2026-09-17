package com.app.common.crypto;

import com.app.common.config.AppProperties;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM authenticated encryption for BYOK provider API keys at rest.
 * Storage layout: [12-byte IV][ciphertext + 16-byte auth tag].
 * Key is injected from environment (PROVIDER_KEY_ENC_SECRET) via AppProperties.
 */
@Service
public class CryptoService {

    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec keySpec;
    private final SecureRandom random = new SecureRandom();

    public CryptoService(AppProperties props) {
        byte[] key = Base64.getDecoder().decode(props.crypto().providerKeySecret());
        if (key.length != 16 && key.length != 24 && key.length != 32) {
            throw new IllegalStateException(
                    "PROVIDER_KEY_ENC_SECRET must decode to 16/24/32 bytes; got " + key.length);
        }
        this.keySpec = new SecretKeySpec(key, "AES");
    }

    public byte[] encrypt(String plaintext) {
        if (plaintext == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array();
        } catch (Exception e) {
            throw new IllegalStateException("Encryption failed", e);
        }
    }

    public String decrypt(byte[] stored) {
        if (stored == null || stored.length < IV_LENGTH + 16) {
            throw new IllegalArgumentException("Invalid encrypted payload");
        }
        try {
            ByteBuffer buf = ByteBuffer.wrap(stored);
            byte[] iv = new byte[IV_LENGTH];
            buf.get(iv);
            byte[] ct = new byte[buf.remaining()];
            buf.get(ct);
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("Decryption failed", e);
        }
    }

    /** Display-only hint that never reveals the full secret, e.g. "sk-...cdef". */
    public static String hint(String apiKey) {
        if (apiKey == null || apiKey.length() < 8) {
            return "****";
        }
        String prefix = apiKey.substring(0, Math.min(3, apiKey.length()));
        String suffix = apiKey.substring(apiKey.length() - 4);
        return prefix + "..." + suffix;
    }
}
