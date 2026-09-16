package com.app.modules.media_asset.repository;

import com.app.modules.media_asset.entity.TermsVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface TermsVersionRepository extends JpaRepository<TermsVersion, String> {

    Optional<TermsVersion> findByCurrentTrue();
}
