package com.app.modules.provider.dto;

import com.app.modules.provider.entity.PlatformAiProvider;

import java.util.List;
import java.util.UUID;

/**
 * User-facing view of a shared platform TTS provider: one key group (all keys of one vendor
 * account family), no base URL, model or key hint. {@code id} is the group's oldest key;
 * {@code keyIds} lists every key of the group so a job bound to any of them maps to this entry.
 */
public record PlatformTtsProviderResponse(
        UUID id,
        String name,
        String protocol,
        List<UUID> keyIds
) {
    /** {@code keys}: one group, representative (oldest) first. */
    public static PlatformTtsProviderResponse from(List<PlatformAiProvider> keys) {
        PlatformAiProvider first = keys.get(0);
        return new PlatformTtsProviderResponse(first.getId(), first.getName(), first.getProtocol(),
                keys.stream().map(PlatformAiProvider::getId).toList());
    }
}
