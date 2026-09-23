package com.app.common.crypto;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-256-GCM authenticated encryption for BYOK provider API keys at rest.
 * Storage layout: [12-byte IV][ciphertext + 16-byte auth tag].
 * Key is injected from environment (PROVIDER_KEY_ENC_SECRET) via AppProperties.
 */
@Slf4j
@Service
public class CryptoService {

    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;
    private static final String SECRET_ENV_KEY = "PROVIDER_KEY_ENC_SECRET";

    private final SecretKeySpec keySpec;
    private final SecureRandom random = new SecureRandom();

    public CryptoService(AppProperties props) {
        String activeSecret = props.crypto().providerKeySecret();
        byte[] key = Base64.getDecoder().decode(activeSecret);
        if (key.length != 16 && key.length != 24 && key.length != 32) {
            throw new IllegalStateException(
                    "PROVIDER_KEY_ENC_SECRET must decode to 16/24/32 bytes; got " + key.length);
        }
        this.keySpec = new SecretKeySpec(key, "AES");
        warnIfEnvFileSecretDiffers(activeSecret);
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
        try {
            if (stored == null || stored.length < IV_LENGTH + 16) {
                throw new IllegalArgumentException("Invalid encrypted payload");
            }
            ByteBuffer buf = ByteBuffer.wrap(stored);
            byte[] iv = new byte[IV_LENGTH];
            buf.get(iv);
            byte[] ct = new byte[buf.remaining()];
            buf.get(ct);
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.error("Decrypt failed — PROVIDER_KEY_ENC_SECRET có thể đã đổi hoặc data hỏng", e);
            throw new AppException(ErrorCode.PROVIDER_KEY_DECRYPTION_FAILED);
        }
    }

    /**
     * Cảnh báo lúc startup nếu secret trong .env (optional:file:../.env / .env theo
     * spring.config.import) lệch với secret đang dùng (OS env ưu tiên cao hơn).
     */
    private void warnIfEnvFileSecretDiffers(String activeSecret) {
        for (String candidate : new String[]{"../.env", ".env"}) {
            try {
                Path path = Path.of(candidate);
                if (!Files.isRegularFile(path)) {
                    continue;
                }
                for (String line : Files.readAllLines(path)) {
                    String trimmed = line.trim();
                    if (trimmed.startsWith(SECRET_ENV_KEY + "=")) {
                        String fileValue = trimmed.substring(SECRET_ENV_KEY.length() + 1).trim();
                        if (!fileValue.isEmpty() && !fileValue.equals(activeSecret)) {
                            log.warn("PROVIDER_KEY_ENC_SECRET in {} differs from the active secret "
                                    + "(OS environment variables take precedence). "
                                    + "Existing encrypted API keys may fail to decrypt.", candidate);
                        }
                        break;
                    }
                }
            } catch (Exception e) {
                log.debug("Could not read {} for secret mismatch check: {}", candidate, e.toString());
            }
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
