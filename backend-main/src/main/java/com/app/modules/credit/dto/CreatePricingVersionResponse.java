package com.app.modules.credit.dto;

import java.util.List;

/** The stored version, the version it closed (if any) and non-blocking warnings. */
public record CreatePricingVersionResponse(
        PricingVersionResponse version,
        PricingVersionResponse closedVersion,
        List<String> warnings
) {
}
