package com.app.modules.provider.dto;

import java.util.List;

public record TestConnectionResponse(
        boolean success,
        String message,
        boolean authSuccess,
        List<CapabilityTestResult> capabilityResults
) {
    public TestConnectionResponse(boolean success, String message) {
        this(success, message, success, List.of());
    }

    public record CapabilityTestResult(String capability, boolean success, String model,
                                       String errorCode, String message) {}
}
