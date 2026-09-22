package com.app.modules.provider.service.impl;

import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.TtsVoicePreviewRequest;
import com.app.modules.provider.dto.TtsVoicePreviewResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.provider.service.TtsPreviewRateLimiter;
import com.app.modules.provider.service.TtsVoiceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class TtsVoiceServiceImpl implements TtsVoiceService {

    private static final String PREVIEW_OBJECT_PREFIX = "previews/tts/";
    private static final String MP3_CONTENT_TYPE = "audio/mpeg";

    private final TtsVoiceRepository ttsVoiceRepository;
    private final UserAiProviderRepository userAiProviderRepository;
    private final CryptoService cryptoService;
    private final AiGatewayClient aiGatewayClient;
    private final ProviderResolverService providerResolverService;
    private final TtsPreviewRateLimiter ttsPreviewRateLimiter;
    private final MediaStorageService mediaStorageService;

    public TtsVoiceServiceImpl(TtsVoiceRepository ttsVoiceRepository,
                               UserAiProviderRepository userAiProviderRepository,
                               CryptoService cryptoService,
                               AiGatewayClient aiGatewayClient,
                               ProviderResolverService providerResolverService,
                               TtsPreviewRateLimiter ttsPreviewRateLimiter,
                               MediaStorageService mediaStorageService) {
        this.ttsVoiceRepository = ttsVoiceRepository;
        this.userAiProviderRepository = userAiProviderRepository;
        this.cryptoService = cryptoService;
        this.aiGatewayClient = aiGatewayClient;
        this.providerResolverService = providerResolverService;
        this.ttsPreviewRateLimiter = ttsPreviewRateLimiter;
        this.mediaStorageService = mediaStorageService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<TtsVoiceResponse> listUserVoices(UUID userId, UUID providerId, String language) {
        userAiProviderRepository.findByIdAndUserId(providerId, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        List<TtsVoice> voices = ttsVoiceRepository.findByUserProviderIdAndIsActiveTrue(providerId);
        if (language != null && !language.isBlank()) {
            String norm = language.trim().toLowerCase();
            voices = voices.stream()
                    .filter(v -> matchesLanguage(v, norm))
                    .toList();
        }

        return voices.stream().map(TtsVoiceResponse::from).toList();
    }

    @Override
    @Transactional
    public List<TtsVoiceResponse> refreshUserVoices(UUID userId, UUID providerId) {
        UserAiProvider provider = userAiProviderRepository.findByIdAndUserId(providerId, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        if (!provider.hasCapability("TTS")) {
            throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
        }

        String rawApiKey = cryptoService.decrypt(provider.getApiKeyEnc());
        List<AiGatewayClient.DiscoveredVoice> discovered = aiGatewayClient.fetchTtsVoices(
                provider.getProtocol(),
                provider.getBaseUrl(),
                rawApiKey,
                provider.getDefaultModel()
        );

        ttsVoiceRepository.deleteByUserProviderId(providerId);

        List<TtsVoice> savedVoices = new ArrayList<>();
        Instant now = Instant.now();
        for (AiGatewayClient.DiscoveredVoice d : discovered) {
            TtsVoice voice = new TtsVoice();
            voice.setProviderSource("USER");
            voice.setUserProviderId(providerId);
            voice.setPlatformProviderId(null);
            voice.setVoiceId(d.voiceId());
            voice.setLanguage(d.language() != null ? d.language().toLowerCase() : "en");
            voice.setLanguages(d.languages() != null && !d.languages().isEmpty()
                    ? d.languages().stream().map(String::toLowerCase).toList()
                    : List.of(voice.getLanguage()));
            voice.setGender(d.gender() != null ? d.gender().toUpperCase() : "UNKNOWN");
            voice.setActive(true);
            voice.setCachedAt(now);

            savedVoices.add(ttsVoiceRepository.save(voice));
        }

        return savedVoices.stream().map(TtsVoiceResponse::from).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<TtsVoiceResponse> listPlatformVoices(String language, String providerSource) {
        String source = (providerSource != null && !providerSource.isBlank())
                ? providerSource.trim().toUpperCase()
                : "PLATFORM";

        List<TtsVoice> voices = ttsVoiceRepository.findByProviderSourceAndIsActiveTrue(source);
        if (language != null && !language.isBlank()) {
            String norm = language.trim().toLowerCase();
            voices = voices.stream()
                    .filter(v -> matchesLanguage(v, norm))
                    .toList();
        }

        return voices.stream().map(TtsVoiceResponse::from).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public TtsVoicePreviewResponse previewVoice(UUID userId, TtsVoicePreviewRequest request) {
        if (ttsPreviewRateLimiter.isRateLimited(userId)) {
            throw new AppException(ErrorCode.TTS_PREVIEW_RATE_LIMIT_EXCEEDED);
        }

        ProviderResolverService.TtsVoiceResolution voice =
                providerResolverService.resolveForTtsVoice(userId, request.voiceId());

        String correlationId = "tts-preview:" + UUID.randomUUID();
        byte[] audio = aiGatewayClient.synthesizeTts(
                voice.protocol(),
                voice.baseUrl(),
                voice.apiKey(),
                voice.defaultModel(),
                voice.voiceId(),
                request.text(),
                correlationId
        );

        String objectKey = PREVIEW_OBJECT_PREFIX + userId + "/" + UUID.randomUUID() + ".mp3";
        mediaStorageService.putMediaObject(
                objectKey, new ByteArrayInputStream(audio), audio.length, MP3_CONTENT_TYPE);
        String audioUrl = mediaStorageService.presignedGetUrl(
                mediaStorageService.mediaBucket() + "/" + objectKey);
        return new TtsVoicePreviewResponse(audioUrl);
    }

    private boolean matchesLanguage(TtsVoice voice, String targetLang) {
        if (voice.getLanguage() != null && voice.getLanguage().equalsIgnoreCase(targetLang)) {
            return true;
        }
        if (voice.getLanguages() != null) {
            return voice.getLanguages().stream().anyMatch(l -> l.equalsIgnoreCase(targetLang));
        }
        return false;
    }
}
