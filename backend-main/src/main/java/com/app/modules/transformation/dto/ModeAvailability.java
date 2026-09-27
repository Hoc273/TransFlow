package com.app.modules.transformation.dto;

public record ModeAvailability(
        boolean available,
        String unavailableReason
) {
}
