package com.app.common.crypto;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CryptoServiceTest {

    private CryptoService cryptoService;

    @BeforeEach
    void setUp() {
        AppProperties.Crypto cryptoProps = new AppProperties.Crypto("MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=");
        AppProperties props = new AppProperties(
                null, null, null, null, null, null, cryptoProps, null
        );
        cryptoService = new CryptoService(props);
    }

    @Test
    void testEncryptDecryptRoundTrip() {
        String plaintext = "sk-test-api-key-1234567890abcdef";
        byte[] encrypted = cryptoService.encrypt(plaintext);

        assertNotNull(encrypted);
        assertTrue(encrypted.length > 28); // 12 IV + ciphertext + 16 Tag

        String decrypted = cryptoService.decrypt(encrypted);
        assertEquals(plaintext, decrypted);
    }

    @Test
    void testEncryptionRandomness() {
        String plaintext = "sk-same-secret";
        byte[] enc1 = cryptoService.encrypt(plaintext);
        byte[] enc2 = cryptoService.encrypt(plaintext);

        assertNotEquals(enc1, enc2, "Different IVs should produce different ciphertexts");
        assertEquals(cryptoService.decrypt(enc1), cryptoService.decrypt(enc2));
    }

    @Test
    void testDecryptTamperedDataThrows() {
        String plaintext = "sk-sensitive-key";
        byte[] encrypted = cryptoService.encrypt(plaintext);
        encrypted[encrypted.length - 1] ^= 0x01; // flip last byte

        AppException ex = assertThrows(AppException.class, () -> cryptoService.decrypt(encrypted));
        assertEquals(ErrorCode.PROVIDER_KEY_DECRYPTION_FAILED, ex.getErrorCode());
    }

    @Test
    void testDecryptInvalidPayloadThrowsProviderKeyDecryptionFailed() {
        AppException ex = assertThrows(AppException.class, () -> cryptoService.decrypt(new byte[20]));

        assertEquals(ErrorCode.PROVIDER_KEY_DECRYPTION_FAILED, ex.getErrorCode());
    }

    @Test
    void testHintGeneration() {
        assertEquals("sk-...cdef", CryptoService.hint("sk-123456789cdef"));
        assertEquals("****", CryptoService.hint("short"));
        assertEquals("****", CryptoService.hint(null));
    }

    @Test
    void testInvalidKeyLengthThrows() {
        AppProperties.Crypto invalidProps = new AppProperties.Crypto("c2hvcnQ="); // "short" base64
        AppProperties props = new AppProperties(null, null, null, null, null, null, invalidProps, null);

        assertThrows(IllegalStateException.class, () -> new CryptoService(props));
    }
}
