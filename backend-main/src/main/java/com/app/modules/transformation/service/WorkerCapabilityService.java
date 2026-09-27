package com.app.modules.transformation.service;

import com.app.modules.transformation.dto.AvailabilityProjection;

/**
 * Projects worker capabilities & readiness for the deployment-wide
 * {@code GET /api/transformation/capabilities} endpoint (API_Contract.md §5.2).
 * Always returns a projection — unhealthy dependencies are reported as DOWN flags, never exceptions.
 */
public interface WorkerCapabilityService {

    AvailabilityProjection getCapabilities();
}
