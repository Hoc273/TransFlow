package com.app.modules.provider.service.impl;

import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.service.ProviderResolverService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * Placeholder implementation pending Member A's full provider/BYOK module
 * (Backend_Java_TaskSplit_MemberB.md §4 — mock permitted while A's module is unfinished).
 * Only {@link #resolveVoiceLanguage} is exercised by media_job in this iteration.
 */
@Service
public class ProviderResolverServiceImpl implements ProviderResolverService {

    private final TtsVoiceRepository ttsVoiceRepository;

    public ProviderResolverServiceImpl(TtsVoiceRepository ttsVoiceRepository) {
        this.ttsVoiceRepository = ttsVoiceRepository;
    }

    @Override
    public ProviderResolution resolveForCapability(UUID userId, String capability) {
        throw new UnsupportedOperationException(
                "ProviderResolverService.resolveForCapability is not implemented yet (Member A's provider module)");
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> resolveVoiceLanguage(UUID ttsVoiceId) {
        return ttsVoiceRepository.findById(ttsVoiceId).map(TtsVoice::getLanguage);
    }
}
