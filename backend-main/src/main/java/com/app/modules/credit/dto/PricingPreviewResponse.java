package com.app.modules.credit.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Impact of a candidate x, y before saving (Credit_Coefficient_Calculation §10.2):
 * per-unit and per-video-minute Credit for this capability, and Credit/minute per job type.
 */
public record PricingPreviewResponse(
        String capability,
        String providerScope,
        /** Version the proposal would replace; null when this pair has no row yet. */
        PricingVersionResponse current,
        long unitsPerMinute,
        Rate currentRate,
        Rate proposedRate,
        /** Relative change in percent; null when there is no current value or it is 0. */
        BigDecimal infraChangePercent,
        BigDecimal tokenChangePercent,
        boolean largeChange,
        List<JobEstimate> jobEstimates,
        List<String> warnings
) {

    /** Credit per billing unit and per video minute, BYOK (x) vs platform source (x + y). */
    public record Rate(BigDecimal byokPerUnit, BigDecimal platformPerUnit,
                       BigDecimal byokPerMinute, BigDecimal platformPerMinute) {
    }

    /** Credit per minute of source video for a job type, platform AI source, default price rows. */
    public record JobEstimate(String jobType, List<String> capabilities,
                              BigDecimal currentCreditsPerMinute, BigDecimal proposedCreditsPerMinute) {
    }
}
