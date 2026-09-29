package com.app.modules.provider.service;

import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.dto.PlatformAiProviderResponse;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdatePlatformAiProviderRequest;

import java.util.List;
import java.util.UUID;

/**
 * Management of the shared platform key pool (platform_ai_providers). No authorization here:
 * the platform module gates every call with {@code PlatformAdminAccessService}.
 */
public interface PlatformProviderService {

    List<PlatformAiProviderResponse> list();

    PlatformAiProviderResponse create(CreatePlatformAiProviderRequest request);

    PlatformAiProviderResponse update(UUID id, UpdatePlatformAiProviderRequest request);

    void delete(UUID id);

    /** Auth + per-capability probe; the result is stored as the key's health. */
    TestConnectionResponse test(UUID id);

    /**
     * Scheduled health check. PAID keys get the full {@link #test(UUID)}; FREE pool proxies
     * (FreeLLMAPI) are checked by auth only: a real completion would spend the free-tier quota
     * on a model the proxy picks at random, and the proxy already fails over on its own.
     */
    TestConnectionResponse healthCheck(UUID id);

    /** Re-discovers the voices of a TTS-capable platform key; returns the active voice count. */
    int syncVoices(UUID id);
}
