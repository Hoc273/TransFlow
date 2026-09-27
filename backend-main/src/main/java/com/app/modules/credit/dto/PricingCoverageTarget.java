package com.app.modules.credit.dto;

import java.util.UUID;

/** One capability served by an active platform provider, to be checked against the price table. */
public record PricingCoverageTarget(UUID providerId, String providerName, String protocol, String model,
                                    String capability) {
}
