package com.app.common.health;

import java.util.Map;

/**
 * Result of a {@code GET /health} probe against an internal service.
 * {@code body} carries the parsed JSON response (empty when the service is down) so callers
 * can read service-specific fields (e.g. backend-ai's {@code separation.engine}).
 */
public record HealthResult(boolean up, long latencyMs, Map<String, Object> body) {
}
