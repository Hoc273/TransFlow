package com.app.modules.provider.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * Thread-bound record of the providers resolved while one media stage attempt runs.
 * The pipeline opens a scope per attempt; {@link ProviderResolverService} records every
 * resolution into it and skips providers that already failed within the same attempt, so
 * a retry lands on another key of the platform pool. Outside a scope (HTTP requests such
 * as refine) resolution behaves exactly as before.
 */
public final class ProviderUsageScope implements AutoCloseable {

    private static final ThreadLocal<ProviderUsageScope> CURRENT = new ThreadLocal<>();

    private final String key;
    private final List<Resolved> resolved = new ArrayList<>();
    private final ProviderUsageScope previous;

    private ProviderUsageScope(String key, ProviderUsageScope previous) {
        this.key = key;
        this.previous = previous;
    }

    /** Opens a scope identified by {@code key} (the stage id) on the current thread. */
    public static ProviderUsageScope open(String key) {
        ProviderUsageScope scope = new ProviderUsageScope(key, CURRENT.get());
        CURRENT.set(scope);
        return scope;
    }

    public static Optional<ProviderUsageScope> current() {
        return Optional.ofNullable(CURRENT.get());
    }

    public String key() {
        return key;
    }

    void record(String capability, UUID providerId, boolean platform, String protocol, String model) {
        resolved.add(new Resolved(capability, providerId, platform, protocol, model));
    }

    /** Every resolution made in this scope, oldest first. */
    public List<Resolved> resolved() {
        return List.copyOf(resolved);
    }

    /** The provider most recently resolved for {@code capability} in this scope. */
    public Optional<Resolved> last(String capability) {
        for (int i = resolved.size() - 1; i >= 0; i--) {
            if (resolved.get(i).capability().equalsIgnoreCase(capability)) {
                return Optional.of(resolved.get(i));
            }
        }
        return Optional.empty();
    }

    @Override
    public void close() {
        if (previous == null) {
            CURRENT.remove();
        } else {
            CURRENT.set(previous);
        }
    }

    public record Resolved(String capability, UUID providerId, boolean platform, String protocol, String model) {

        /** Credit pricing key {@code protocol/model} (credit_pricing_config.provider_scope), or null. */
        public String pricingScope() {
            if (protocol == null || protocol.isBlank()) {
                return null;
            }
            String p = protocol.trim().toLowerCase(Locale.ROOT);
            return model == null || model.isBlank() ? p : p + "/" + model.trim().toLowerCase(Locale.ROOT);
        }
    }

    /** Package hook for the resolver implementation. */
    public static void recordResolution(String capability, UUID providerId, boolean platform) {
        recordResolution(capability, providerId, platform, null, null);
    }

    public static void recordResolution(String capability, UUID providerId, boolean platform,
                                        String protocol, String model) {
        ProviderUsageScope scope = CURRENT.get();
        if (scope != null && providerId != null) {
            scope.record(capability, providerId, platform, protocol, model);
        }
    }
}
