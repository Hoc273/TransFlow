package com.app.modules.platform.service;

import java.util.UUID;

/**
 * Service-layer Super Admin gate (System_Architecture §11.1). Always loads the flag
 * from DB so a revoked admin is denied even if an old JWT is still valid.
 */
public interface PlatformAdminAccessService {

    /**
     * @return id of the admin user
     * @throws com.app.common.exception.AppException USER_NOT_FOUND (401) if the user no
     *         longer exists, UNAUTHORIZED (403) if not a platform admin
     */
    UUID requirePlatformAdmin(UUID userId);
}
