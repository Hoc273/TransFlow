package com.app.modules.provider.dto;

import com.app.modules.provider.entity.PlatformAiProvider;

import java.util.UUID;

/** User-facing view of a shared platform TTS key: no base URL, model or key hint. */
public record PlatformTtsProviderResponse(
        UUID id,
        String name,
        String protocol
) {
    public static PlatformTtsProviderResponse from(PlatformAiProvider p) {
        return new PlatformTtsProviderResponse(p.getId(), p.getName(), p.getProtocol());
    }
}
