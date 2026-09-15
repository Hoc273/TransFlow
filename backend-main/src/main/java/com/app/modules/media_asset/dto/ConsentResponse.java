package com.app.modules.media_asset.dto;

import com.app.modules.media_asset.entity.MediaConsent;

import java.time.Instant;
import java.util.UUID;

public record ConsentResponse(
        UUID id,
        UUID rootAssetId,
        String termsVersion,
        Instant consentedAt
) {
    public static ConsentResponse from(MediaConsent consent) {
        return new ConsentResponse(
                consent.getId(),
                consent.getRootAssetId(),
                consent.getTermsVersion(),
                consent.getConsentedAt()
        );
    }
}
