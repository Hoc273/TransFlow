package com.app.modules.provider.util;

import com.app.modules.provider.entity.PlatformAiProvider;

import java.net.URI;
import java.util.Comparator;
import java.util.Locale;
import java.util.Set;

/**
 * Platform keys of one vendor account family form a group: they serve the same models and voices,
 * so users see the group as one provider and the resolver spreads load over its keys.
 *
 * <p>Speech vendors publish one global voice catalog (an Azure voice id is the same in every
 * region), so the protocol alone is the group. Other protocols also need the host: two
 * {@code openai_compatible} keys at api.openai.com and at a FreeLLMAPI proxy are different
 * vendors whose voice names ("alloy") mean different voices.
 */
public final class ProviderKeyGroup {

    private static final Set<String> VENDOR_WIDE = Set.of("azure_speech", "google_speech", "elevenlabs_native");

    /** Representative first: the oldest key keeps the group id stable when keys are added. */
    public static final Comparator<PlatformAiProvider> OLDEST_FIRST = Comparator
            .comparing((PlatformAiProvider p) -> p.getCreatedAt() == null ? java.time.Instant.EPOCH : p.getCreatedAt())
            .thenComparing(p -> p.getId() == null ? "" : p.getId().toString());

    private ProviderKeyGroup() {
    }

    public static String of(PlatformAiProvider provider) {
        return of(provider.getProtocol(), provider.getBaseUrl());
    }

    public static String of(String protocol, String baseUrl) {
        String proto = protocol == null ? "" : protocol.trim().toLowerCase(Locale.ROOT);
        if (VENDOR_WIDE.contains(proto)) {
            return proto;
        }
        String authority = authority(baseUrl);
        return authority.isEmpty() ? proto : proto + "@" + authority;
    }

    public static boolean sameGroup(PlatformAiProvider a, PlatformAiProvider b) {
        return a != null && b != null && of(a).equals(of(b));
    }

    private static String authority(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return "";
        }
        try {
            // Host and port only: never let userinfo in the URL reach a group id.
            URI uri = URI.create(baseUrl.trim());
            if (uri.getHost() == null) {
                return "";
            }
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            return uri.getPort() == -1 ? host : host + ":" + uri.getPort();
        } catch (IllegalArgumentException ex) {
            return "";
        }
    }
}
