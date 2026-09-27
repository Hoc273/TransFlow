package com.app.modules.provider.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record PreviewTtsVoiceRequest(
        @NotNull(message = "voiceId is required")
        UUID voiceId,

        @NotBlank(message = "text is required")
        @Size(max = 50, message = "text cannot exceed 50 characters")
        String text
) {}
