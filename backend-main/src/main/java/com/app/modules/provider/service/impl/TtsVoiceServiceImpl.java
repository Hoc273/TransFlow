package com.app.modules.provider.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.crypto.CryptoService;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.dto.PlatformTtsProviderResponse;
import com.app.modules.provider.dto.PreviewTtsVoiceRequest;
import com.app.modules.provider.dto.PreviewTtsVoiceResponse;
import com.app.modules.provider.dto.TtsVoiceResponse;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.TtsVoice;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.TtsVoiceRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.TtsVoicePreviewRateLimiter;
import com.app.modules.provider.service.TtsVoiceService;
import com.app.modules.provider.util.AudioContentDetector;
import com.app.modules.provider.util.TtsVoiceCatalog;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class TtsVoiceServiceImpl implements TtsVoiceService {

    private final TtsVoiceRepository ttsVoiceRepository;
    private final UserAiProviderRepository userAiProviderRepository;
    private final PlatformAiProviderRepository platformAiProviderRepository;
    private final CryptoService cryptoService;
    private final AiGatewayClient aiGatewayClient;
    private final MediaStorageService mediaStorageService;
    private final TtsVoicePreviewRateLimiter previewRateLimiter;
    private final int presignedTtlSeconds;

    public TtsVoiceServiceImpl(TtsVoiceRepository ttsVoiceRepository,
                               UserAiProviderRepository userAiProviderRepository,
                               PlatformAiProviderRepository platformAiProviderRepository,
                               CryptoService cryptoService,
                               AiGatewayClient aiGatewayClient,
                               MediaStorageService mediaStorageService,
                               TtsVoicePreviewRateLimiter previewRateLimiter,
                               AppProperties props) {
        this.ttsVoiceRepository = ttsVoiceRepository;
        this.userAiProviderRepository = userAiProviderRepository;
        this.platformAiProviderRepository = platformAiProviderRepository;
        this.cryptoService = cryptoService;
        this.aiGatewayClient = aiGatewayClient;
        this.mediaStorageService = mediaStorageService;
        this.previewRateLimiter = previewRateLimiter;
        this.presignedTtlSeconds = props.storage().presignedTtlSeconds();
    }

    @Override
    @Transactional(readOnly = true)
    public List<TtsVoiceResponse> listUserVoices(UUID userId, UUID providerId, String language) {
        userAiProviderRepository.findByIdAndUserId(providerId, userId)
                .orElseThrow(() -> new AppException(ErrorCode.PROVIDER_NOT_FOUND));

        List<TtsVoice> voices = ttsVoiceRepository.findByUserProviderIdAndIsActiveTrue(providerId);
        return sortedForLanguage(voices, language);
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

        if (discovered == null || discovered.isEmpty()) {
            // An empty or failed discovery must never wipe a working voice catalog.
            throw new AppException(ErrorCode.PROVIDER_VOICES_FETCH_FAILED);
        }

        List<TtsVoice> active = TtsVoiceCatalog.synchronize(ttsVoiceRepository,
                ttsVoiceRepository.findByUserProviderId(providerId), discovered, () -> {
                    TtsVoice voice = new TtsVoice();
                    voice.setProviderSource("USER");
                    voice.setUserProviderId(providerId);
                    return voice;
                });

        return active.stream()
                .sorted(TtsVoiceCatalog.ordering(null, active))
                .map(TtsVoiceResponse::from)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<TtsVoiceResponse> listPlatformVoices(String language, UUID platformProviderId) {
        // Always PLATFORM: BYOK voices belong to their owner and are listed via /users/me/providers.
        List<TtsVoice> voices = ttsVoiceRepository.findByProviderSourceAndIsActiveTrue("PLATFORM");
        if (platformProviderId != null) {
            voices = voices.stream()
                    .filter(v -> platformProviderId.equals(v.getPlatformProviderId()))
                    .toList();
        }
        return sortedForLanguage(voices, language);
    }

    @Override
    @Transactional(readOnly = true)
    public List<PlatformTtsProviderResponse> listPlatformTtsProviders() {
        return platformAiProviderRepository.findByIsActiveTrue().stream()
                .filter(p -> p.hasCapability("TTS"))
                .sorted(Comparator.comparingInt((PlatformAiProvider p) -> p.getPriority())
                        .thenComparing(PlatformAiProvider::getName,
                                Comparator.nullsLast(String::compareToIgnoreCase)))
                .map(PlatformTtsProviderResponse::from)
                .toList();
    }

    @Override
    public PreviewTtsVoiceResponse previewVoice(UUID userId, PreviewTtsVoiceRequest request) {
        TtsVoice voice = ttsVoiceRepository.findById(request.voiceId())
                .filter(TtsVoice::isActive)
                .orElseThrow(() -> new AppException(ErrorCode.TTS_VOICE_NOT_FOUND));

        ResolvedProvider provider = resolveVoiceProvider(voice, userId);
        previewRateLimiter.check(userId);

        String audioBase64 = aiGatewayClient.synthesizeTtsPreview(
                provider.protocol(), provider.baseUrl(), provider.apiKey(), provider.model(),
                voice.getVoiceId(), request.text().trim());
        if (audioBase64 == null) {
            throw new AppException(ErrorCode.TTS_PREVIEW_FAILED);
        }
        final byte[] audio;
        try {
            audio = Base64.getDecoder().decode(audioBase64);
        } catch (IllegalArgumentException ex) {
            throw new AppException(ErrorCode.TTS_PREVIEW_FAILED);
        }
        if (audio.length == 0) {
            throw new AppException(ErrorCode.TTS_PREVIEW_FAILED);
        }

        AudioContentDetector.Detected detected = AudioContentDetector.detect(audio);
        String objectKey = "temp/voice-preview/" + userId + "/" + UUID.randomUUID() + "." + detected.extension();
        mediaStorageService.putMediaObject(objectKey, new ByteArrayInputStream(audio), audio.length, detected.mimeType());
        String audioUrl = mediaStorageService.presignedGetUrl(mediaStorageService.mediaBucket() + "/" + objectKey);
        return new PreviewTtsVoiceResponse(audioUrl, presignedTtlSeconds);
    }

    private record ResolvedProvider(String protocol, String baseUrl, String apiKey, String model) {
    }

    private ResolvedProvider resolveVoiceProvider(TtsVoice voice, UUID userId) {
        if ("USER".equalsIgnoreCase(voice.getProviderSource())) {
            // Only the BYOK owner may preview — the call spends their API key.
            UserAiProvider p = voice.getUserProviderId() == null ? null
                    : userAiProviderRepository.findByIdAndUserId(voice.getUserProviderId(), userId)
                            .filter(UserAiProvider::isActive).orElse(null);
            if (p == null) {
                throw new AppException(ErrorCode.TTS_VOICE_NOT_FOUND);
            }
            if (!p.hasCapability("TTS")) {
                throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
            }
            return new ResolvedProvider(p.getProtocol(), p.getBaseUrl(),
                    cryptoService.decrypt(p.getApiKeyEnc()), p.getDefaultModel());
        }
        PlatformAiProvider p = voice.getPlatformProviderId() == null ? null
                : platformAiProviderRepository.findById(voice.getPlatformProviderId())
                        .filter(PlatformAiProvider::isActive).orElse(null);
        if (p == null) {
            throw new AppException(ErrorCode.PLATFORM_PROVIDER_NOT_CONFIGURED);
        }
        if (!p.hasCapability("TTS")) {
            throw new AppException(ErrorCode.PROVIDER_CAPABILITY_NOT_SUPPORTED);
        }
        return new ResolvedProvider(p.getProtocol(), p.getBaseUrl(),
                cryptoService.decrypt(p.getApiKeyEnc()), p.getDefaultModel());
    }

    /** Language-compatible voices (when a language is given) in picker order — first = default pick. */
    private List<TtsVoiceResponse> sortedForLanguage(List<TtsVoice> voices, String language) {
        String norm = language != null && !language.isBlank() ? language.trim().toLowerCase(Locale.ROOT) : null;
        List<TtsVoice> compatible = voices.stream()
                .filter(v -> norm == null || v.isLanguageCompatible(norm))
                .toList();
        return compatible.stream()
                .sorted(TtsVoiceCatalog.ordering(norm, compatible))
                .map(TtsVoiceResponse::from)
                .toList();
    }
}
