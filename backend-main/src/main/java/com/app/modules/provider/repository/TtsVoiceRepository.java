package com.app.modules.provider.repository;

import com.app.modules.provider.entity.TtsVoice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface TtsVoiceRepository extends JpaRepository<TtsVoice, UUID> {

    List<TtsVoice> findByUserProviderIdAndIsActiveTrue(UUID userProviderId);

    List<TtsVoice> findByUserProviderIdAndIsActiveTrueAndLanguageIgnoreCase(UUID userProviderId, String language);

    List<TtsVoice> findByProviderSourceAndIsActiveTrue(String providerSource);

    List<TtsVoice> findByProviderSourceAndIsActiveTrueAndLanguageIgnoreCase(String providerSource, String language);

    List<TtsVoice> findByVoiceIdAndIsActiveTrue(String voiceId);

    @Modifying
    void deleteByUserProviderId(UUID userProviderId);
}
