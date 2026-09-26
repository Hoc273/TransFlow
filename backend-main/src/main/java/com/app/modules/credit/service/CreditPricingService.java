package com.app.modules.credit.service;

import com.app.modules.credit.dto.CreatePricingVersionRequest;
import com.app.modules.credit.dto.CreatePricingVersionResponse;
import com.app.modules.credit.dto.PricingCoverageItem;
import com.app.modules.credit.dto.PricingCoverageTarget;
import com.app.modules.credit.dto.PricingPreviewRequest;
import com.app.modules.credit.dto.PricingPreviewResponse;
import com.app.modules.credit.dto.PricingVersionResponse;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Versioned credit price table x, y (Credit_Coefficient_Calculation §10). Rows are never
 * updated in place or deleted: a change closes the open version and inserts a new one.
 * No authorization here — the platform module gates every call to Super Admin.
 */
public interface CreditPricingService {

    /** Used by billing only when no price row matches (visible as MISSING in coverage). */
    BigDecimal FALLBACK_INFRA_X = new BigDecimal("0.000100");
    BigDecimal FALLBACK_TOKEN_Y = new BigDecimal("0.000500");

    /** Versions in effect now plus the ones scheduled for later. */
    List<PricingVersionResponse> listCurrent();

    /** All versions, newest first; {@code capability}/{@code providerScope} null = no filter. */
    List<PricingVersionResponse> history(String capability, String providerScope, boolean anyScope);

    CreatePricingVersionResponse createVersion(UUID adminUserId, CreatePricingVersionRequest request);

    PricingPreviewResponse preview(PricingPreviewRequest request);

    List<PricingCoverageItem> coverage(List<PricingCoverageTarget> targets);
}
