package com.app.modules.platform.service.impl;

import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformProviderAdminService;
import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.dto.PlatformAiProviderResponse;
import com.app.modules.provider.dto.TestConnectionResponse;
import com.app.modules.provider.dto.UpdatePlatformAiProviderRequest;
import com.app.modules.provider.service.PlatformProviderService;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class PlatformProviderAdminServiceImpl implements PlatformProviderAdminService {

    private final PlatformAdminAccessService accessService;
    private final PlatformProviderService providerService;

    public PlatformProviderAdminServiceImpl(PlatformAdminAccessService accessService,
                                            PlatformProviderService providerService) {
        this.accessService = accessService;
        this.providerService = providerService;
    }

    @Override
    public List<PlatformAiProviderResponse> list(UUID callerId) {
        accessService.requirePlatformAdmin(callerId);
        return providerService.list();
    }

    @Override
    public PlatformAiProviderResponse create(UUID callerId, CreatePlatformAiProviderRequest request) {
        accessService.requirePlatformAdmin(callerId);
        return providerService.create(request);
    }

    @Override
    public PlatformAiProviderResponse update(UUID callerId, UUID providerId, UpdatePlatformAiProviderRequest request) {
        accessService.requirePlatformAdmin(callerId);
        return providerService.update(providerId, request);
    }

    @Override
    public void delete(UUID callerId, UUID providerId) {
        accessService.requirePlatformAdmin(callerId);
        providerService.delete(providerId);
    }

    @Override
    public TestConnectionResponse test(UUID callerId, UUID providerId) {
        accessService.requirePlatformAdmin(callerId);
        return providerService.test(providerId);
    }

    @Override
    public int syncVoices(UUID callerId, UUID providerId) {
        accessService.requirePlatformAdmin(callerId);
        return providerService.syncVoices(providerId);
    }
}
