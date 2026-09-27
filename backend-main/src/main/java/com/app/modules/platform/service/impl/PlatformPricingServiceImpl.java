package com.app.modules.platform.service.impl;

import com.app.modules.credit.dto.CreatePricingVersionRequest;
import com.app.modules.credit.dto.CreatePricingVersionResponse;
import com.app.modules.credit.dto.PricingCoverageItem;
import com.app.modules.credit.dto.PricingCoverageTarget;
import com.app.modules.credit.dto.PricingPreviewRequest;
import com.app.modules.credit.dto.PricingPreviewResponse;
import com.app.modules.credit.dto.PricingVersionResponse;
import com.app.modules.credit.service.CreditPricingService;
import com.app.modules.platform.service.PlatformAdminAccessService;
import com.app.modules.platform.service.PlatformPricingService;
import com.app.modules.provider.dto.PlatformAiProviderResponse;
import com.app.modules.provider.service.PlatformProviderService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class PlatformPricingServiceImpl implements PlatformPricingService {

    private final PlatformAdminAccessService accessService;
    private final CreditPricingService pricingService;
    private final PlatformProviderService providerService;

    public PlatformPricingServiceImpl(PlatformAdminAccessService accessService,
                                      CreditPricingService pricingService,
                                      PlatformProviderService providerService) {
        this.accessService = accessService;
        this.pricingService = pricingService;
        this.providerService = providerService;
    }

    @Override
    public List<PricingVersionResponse> listCurrent(UUID callerId) {
        accessService.requirePlatformAdmin(callerId);
        return pricingService.listCurrent();
    }

    @Override
    public List<PricingVersionResponse> history(UUID callerId, String capability, String providerScope) {
        accessService.requirePlatformAdmin(callerId);
        // providerScope absent = every scope; "default" = only the NULL-scope rows.
        boolean anyScope = providerScope == null;
        String scope = "default".equalsIgnoreCase(providerScope) ? null : providerScope;
        return pricingService.history(capability, scope, anyScope);
    }

    @Override
    public CreatePricingVersionResponse create(UUID callerId, CreatePricingVersionRequest request) {
        accessService.requirePlatformAdmin(callerId);
        return pricingService.createVersion(callerId, request);
    }

    @Override
    public PricingPreviewResponse preview(UUID callerId, PricingPreviewRequest request) {
        accessService.requirePlatformAdmin(callerId);
        return pricingService.preview(request);
    }

    @Override
    public List<PricingCoverageItem> coverage(UUID callerId) {
        accessService.requirePlatformAdmin(callerId);
        List<PricingCoverageTarget> targets = new ArrayList<>();
        for (PlatformAiProviderResponse p : providerService.list()) {
            if (!p.isActive()) {
                continue;
            }
            for (String capability : p.capabilities()) {
                targets.add(new PricingCoverageTarget(p.id(), p.name(), p.protocol(), p.defaultModel(), capability));
                // The TRANSLATE key also writes summary scripts (billed as SUMMARIZE_SCRIPT).
                if ("TRANSLATE".equals(capability)) {
                    targets.add(new PricingCoverageTarget(p.id(), p.name(), p.protocol(), p.defaultModel(),
                            "SUMMARIZE_SCRIPT"));
                }
            }
        }
        return pricingService.coverage(targets);
    }
}
