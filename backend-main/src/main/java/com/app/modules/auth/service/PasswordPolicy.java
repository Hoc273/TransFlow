package com.app.modules.auth.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;

import java.nio.charset.StandardCharsets;

/**
 * BCrypt only hashes the first 72 bytes (Spring Security rejects longer input with an
 * IllegalArgumentException → 500). Checked in bytes, not chars: Vietnamese diacritics
 * take 2–3 bytes each in UTF-8.
 */
public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;
    public static final int MAX_BYTES = 72;

    private PasswordPolicy() {
    }

    public static boolean fitsBcrypt(String password) {
        return password != null && password.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES;
    }

    /** For passwords about to be hashed and stored. */
    public static void requireAcceptable(String password) {
        if (password == null || password.length() < MIN_LENGTH || !fitsBcrypt(password)) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
    }
}
