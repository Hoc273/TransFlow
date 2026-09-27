package com.app.modules.platform.dto;

import java.time.Instant;
import java.util.List;

/** {@code GET /api/platform/status} — core service probes (API_Contract.md §13.1). */
public record PlatformStatusResponse(
        Instant checkedAt,
        String overall,
        List<ServiceStatus> services
) {
    public record ServiceStatus(
            String id,
            String name,
            String status,
            Long latencyMs,
            String message
    ) {}
}
