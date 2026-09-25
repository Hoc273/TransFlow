package com.app.modules.platform.service;

import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.dto.PlatformAiProviderResponse;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdatePlatformAiProviderRequest;

import java.util.List;
import java.util.UUID;

/** Super Admin management of the shared platform key pool (API_Contract.md §13.1). */
public interface PlatformProviderAdminService {

    List<PlatformAiProviderResponse> list(UUID callerId);

    PlatformAiProviderResponse create(UUID callerId, CreatePlatformAiProviderRequest request);

    PlatformAiProviderResponse update(UUID callerId, UUID providerId, UpdatePlatformAiProviderRequest request);

    void delete(UUID callerId, UUID providerId);

    TestConnectionResponse test(UUID callerId, UUID providerId);

    int syncVoices(UUID callerId, UUID providerId);
}
