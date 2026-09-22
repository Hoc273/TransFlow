package com.app.modules.provider.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Request body for {@code POST /api/tts-voices/preview} — short text synthesized with the
 * chosen catalog voice so users can hear it before assigning it to a job (API_Contract.md §11).
 */
public record TtsVoicePreviewRequest(

        @NotNull
        UUID voiceId,

        @NotBlank
        @Size(max = 50)
        String text
) {}
