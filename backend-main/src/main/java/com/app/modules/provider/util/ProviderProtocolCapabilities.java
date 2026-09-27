package com.app.modules.provider.util;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;

import java.util.Collection;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Capabilities each protocol adapter in the AI gateway can execute
 * ({@code backend-ai/app/services/protocol/*.py supported_capabilities}; TEXT ↔ TRANSLATE).
 *
 * <p>Saving a combination the adapter cannot run (Anthropic + TTS, Azure + STT) used to succeed
 * and only fail later inside a media job, so it is rejected up front.
 */
public final class ProviderProtocolCapabilities {

    public static final Map<String, Set<String>> SUPPORTED = Map.of(
            "openai_compatible", Set.of("TRANSLATE", "STT", "TTS", "VISION"),
            "anthropic", Set.of("TRANSLATE", "VISION"),
            "dashscope_native", Set.of("TRANSLATE", "STT", "TTS"),
            "elevenlabs_native", Set.of("TTS"),
            "azure_speech", Set.of("TTS"),
            "google_speech", Set.of("TTS")
    );

    private ProviderProtocolCapabilities() {
    }

    /** Throws {@code PROVIDER_CAPABILITY_NOT_SUPPORTED} when {@code protocol} cannot serve a capability. */
    public static void require(String protocol, Collection<String> capabilities) {
        Set<String> supported = protocol == null ? null : SUPPORTED.get(protocol.trim().toLowerCase(Locale.ROOT));
        if (supported == null) {
            throw new AppException(ErrorCode.INVALID_PROVIDER_PROTOCOL);
        }
        for (String capability : capabilities) {
            if (capability == null || !supported.contains(capability.trim().toUpperCase(Locale.ROOT))) {
                throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
            }
        }
    }
}
