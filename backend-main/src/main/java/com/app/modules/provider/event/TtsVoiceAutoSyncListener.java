package com.app.modules.provider.event;

import com.app.modules.provider.service.PlatformProviderService;
import com.app.modules.provider.service.TtsVoiceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Loads a provider's voice catalog once the provider row is committed. Runs off the request
 * thread (vendor discovery can take seconds) and never fails the save: a failed discovery only
 * leaves the manual "sync voices" action and the daily platform sync to fill the catalog.
 */
@Component
public class TtsVoiceAutoSyncListener {

    private static final Logger log = LoggerFactory.getLogger(TtsVoiceAutoSyncListener.class);

    private final PlatformProviderService platformProviderService;
    private final TtsVoiceService ttsVoiceService;

    public TtsVoiceAutoSyncListener(PlatformProviderService platformProviderService,
                                    TtsVoiceService ttsVoiceService) {
        this.platformProviderService = platformProviderService;
        this.ttsVoiceService = ttsVoiceService;
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSyncRequested(TtsVoiceSyncRequested event) {
        try {
            int active = event.isPlatform()
                    ? platformProviderService.syncVoices(event.providerId())
                    : ttsVoiceService.refreshUserVoices(event.userId(), event.providerId()).size();
            log.info("Auto voice sync for {} provider {}: {} active voice(s)",
                    event.isPlatform() ? "platform" : "user", event.providerId(), active);
        } catch (RuntimeException ex) {
            log.warn("Auto voice sync for {} provider {} failed: {}",
                    event.isPlatform() ? "platform" : "user", event.providerId(), ex.toString());
        }
    }
}
