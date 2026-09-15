package com.app.common.security;

import com.app.common.exception.ApiException;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Convenience accessor for the authenticated principal in the current request.
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static AuthenticatedUser require() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthenticatedUser u) {
            return u;
        }
        throw ApiException.unauthorized("Not authenticated");
    }
}
