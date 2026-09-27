package com.app.modules.transformation.dto;

public record WorkerCapabilitySummary(
        String state,
        int workerCount,
        int compatibleFastWorkers,
        int compatibleStudioWorkers
) {
}
