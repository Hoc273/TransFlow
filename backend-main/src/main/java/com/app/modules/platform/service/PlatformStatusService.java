package com.app.modules.platform.service;

import com.app.modules.platform.dto.PlatformStatusResponse;

import java.util.UUID;

/**
 * Probes the core services for Super Admin status (API_Contract.md §13.1).
 * Fail-open per service; never throws — DOWN/DEGRADED is reported via flags.
 */
public interface PlatformStatusService {

    PlatformStatusResponse status(UUID callerId);
}
