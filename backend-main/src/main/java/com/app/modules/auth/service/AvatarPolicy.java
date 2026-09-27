package com.app.modules.auth.service;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;

import java.net.URI;
import java.util.regex.Pattern;

/**
 * Avatars arrive as a client-resized base64 data URL (ProfileSection) or an https URL.
 * Anything else — {@code javascript:}/{@code data:text/html}, SVG (can carry script),
 * plain http, or a multi-MB blob stuffed into {@code users.avatar_url} — is refused.
 */
public final class AvatarPolicy {

    /** ~1.1MB decoded image (base64 inflates by 4/3); the client resizes to 400px so real avatars are far smaller. */
    static final int MAX_DATA_URL_CHARS = 1_500_000;
    static final int MAX_URL_CHARS = 2048;

    private static final Pattern DATA_URL =
            Pattern.compile("^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$");

    private AvatarPolicy() {
    }

    /** Returns the value to store: {@code null} to clear, otherwise the validated avatar. */
    public static String sanitize(String avatarUrl) {
        if (avatarUrl == null) {
            return null;
        }
        String v = avatarUrl.trim();
        if (v.isEmpty()) {
            return null;
        }
        if (v.startsWith("data:")) {
            if (v.length() <= MAX_DATA_URL_CHARS && DATA_URL.matcher(v).matches()) {
                return v;
            }
            throw new AppException(ErrorCode.INVALID_AVATAR);
        }
        if (v.length() <= MAX_URL_CHARS && isHttpsUrl(v)) {
            return v;
        }
        throw new AppException(ErrorCode.INVALID_AVATAR);
    }

    private static boolean isHttpsUrl(String v) {
        try {
            URI uri = URI.create(v);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }
}
