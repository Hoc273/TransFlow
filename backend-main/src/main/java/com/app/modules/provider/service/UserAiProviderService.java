package com.app.modules.provider.service;

import com.app.modules.provider.dto.CreateUserAiProviderRequest;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdateUserAiProviderRequest;
import com.app.modules.provider.dto.UserAiProviderResponse;

import java.util.List;
import java.util.UUID;

public interface UserAiProviderService {

    List<UserAiProviderResponse> listProviders(UUID userId);

    UserAiProviderResponse getProvider(UUID userId, UUID id);

    UserAiProviderResponse createProvider(UUID userId, CreateUserAiProviderRequest request);

    UserAiProviderResponse updateProvider(UUID userId, UUID id, UpdateUserAiProviderRequest request);

    void deleteProvider(UUID userId, UUID id);

    TestConnectionResponse testProvider(UUID userId, UUID id, String capability);
}
