package com.app.common.security;

import java.util.UUID;

/**
 * Principal stored in the SecurityContext for an authenticated request.
 */
public record AuthenticatedUser(UUID id, String email) {
}
