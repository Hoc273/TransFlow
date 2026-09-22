package com.app.modules.provider.dto;

public record PreviewTtsVoiceResponse(
        String audioUrl,
        int expiresInSeconds
) {}
