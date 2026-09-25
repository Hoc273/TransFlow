package com.app.modules.provider.service;

import java.util.UUID;

/**
 * Short-lived availability of platform pool keys (Redis cooldowns) plus the persisted
 * health flag. Public boundary used by media_job to report provider failures so the
 * resolver fails over to another key of the pool.
 */
public interface ProviderHealthService {

    /**
     * Reports that a call through the providers resolved in the current {@link ProviderUsageScope}
     * failed with {@code errorCode}. Platform keys get a cooldown (or are marked DOWN for
     * credential errors); every failed provider is excluded for the rest of the scope.
     *
     * @return true when the error is a provider-side failure worth retrying on another key
     */
    boolean reportScopeFailure(String errorCode);

    /** True while the key is cooling down after a rate limit / outage. */
    boolean isCoolingDown(UUID providerId);

    /** True when {@code providerId} already failed inside the scope identified by {@code scopeKey}. */
    boolean isExcludedForScope(String scopeKey, UUID providerId);

    /**
     * True when the platform pool still has another available key for {@code capability}
     * besides the ones excluded in the current scope.
     */
    boolean hasPlatformAlternative(String capability);
}
