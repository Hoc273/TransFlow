package com.app.modules.provider.dto;

public record TestConnectionResponse(
        boolean success,
        String message
) {}
