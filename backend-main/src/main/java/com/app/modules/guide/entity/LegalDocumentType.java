package com.app.modules.guide.entity;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;

import java.util.Locale;

/** Legal pages shown under the public Guide; path segment = lower-case name. */
public enum LegalDocumentType {
    TERMS,
    PRIVACY;

    public static LegalDocumentType fromPath(String value) {
        if (value != null) {
            try {
                return valueOf(value.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException ignored) {
                // fall through
            }
        }
        throw new AppException(ErrorCode.LEGAL_DOCUMENT_NOT_FOUND);
    }
}
