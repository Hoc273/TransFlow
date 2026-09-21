package com.app.modules.transformation.dto;

import java.util.List;
import java.util.Map;

public record AvailabilityProjection(
        String protocolVersion,
        List<String> supportedExecutionModes,
        String defaultExecutionMode,
        Map<String, ModeAvailability> availability,
        WorkerCapabilitySummary workerCapability,
        ReadinessSummary readiness
) {
}
