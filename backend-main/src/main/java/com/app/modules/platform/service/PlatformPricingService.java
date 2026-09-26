package com.app.modules.platform.service;

import com.app.modules.credit.dto.CreatePricingVersionRequest;
import com.app.modules.credit.dto.CreatePricingVersionResponse;
import com.app.modules.credit.dto.PricingCoverageItem;
import com.app.modules.credit.dto.PricingPreviewRequest;
import com.app.modules.credit.dto.PricingPreviewResponse;
import com.app.modules.credit.dto.PricingVersionResponse;

import java.util.List;
import java.util.UUID;

/**
 * Super Admin management of the credit price table x, y (Credit_Coefficient_Calculation §10).
 * Every method enforces {@link PlatformAdminAccessService#requirePlatformAdmin}.
 */
public interface PlatformPricingService {

    List<PricingVersionResponse> listCurrent(UUID callerId);

    List<PricingVersionResponse> history(UUID callerId, String capability, String providerScope);

    CreatePricingVersionResponse create(UUID callerId, CreatePricingVersionRequest request);

    PricingPreviewResponse preview(UUID callerId, PricingPreviewRequest request);

    /** Price row that each capability of every active platform key resolves to today. */
    List<PricingCoverageItem> coverage(UUID callerId);
}
