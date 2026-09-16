package com.app.modules.media_asset.repository;

import com.app.modules.media_asset.entity.MediaConsent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface MediaConsentRepository extends JpaRepository<MediaConsent, UUID> {

    Optional<MediaConsent> findByRootAssetIdAndTermsVersion(UUID rootAssetId, String termsVersion);

    boolean existsByRootAssetIdAndTermsVersion(UUID rootAssetId, String termsVersion);
}
