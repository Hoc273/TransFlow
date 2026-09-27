package com.app.modules.provider.maintenance;

import com.app.common.config.AppProperties;
import com.app.common.crypto.CryptoService;
import com.app.common.health.ServiceHealthProbe;
import com.app.modules.notification.service.NotificationService;
import com.app.modules.provider.client.AiGatewayClient;
import com.app.modules.provider.entity.PlatformAiProvider;
import com.app.modules.provider.entity.UserAiProvider;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.repository.UserAiProviderRepository;
import com.app.modules.provider.service.PlatformProviderService;
import com.app.modules.workspace.service.WorkspaceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * Periodic provider checks:
 * <ul>
 *   <li>platform pool keys (every 30 min): auth + per-capability probe, broken keys leave the pool;</li>
 *   <li>platform TTS voice catalog (daily): upsert, dropped voices are deactivated;</li>
 *   <li>personal BYOK keys (daily): auth only (no billed probe); the owner is notified once when a
 *       key starts failing.</li>
 * </ul>
 * Every round is skipped while backend-ai itself is down, so a gateway outage never marks keys DOWN.
 */
@Component
public class ProviderHealthCheckJob {

    private static final Logger log = LoggerFactory.getLogger(ProviderHealthCheckJob.class);

    private final PlatformAiProviderRepository platformRepository;
    private final UserAiProviderRepository userRepository;
    private final PlatformProviderService platformProviderService;
    private final AiGatewayClient aiGatewayClient;
    private final CryptoService cryptoService;
    private final NotificationService notificationService;
    private final WorkspaceService workspaceService;
    private final ServiceHealthProbe healthProbe;
    private final String aiBaseUrl;
    private final boolean enabled;

    public ProviderHealthCheckJob(PlatformAiProviderRepository platformRepository,
                                  UserAiProviderRepository userRepository,
                                  PlatformProviderService platformProviderService,
                                  AiGatewayClient aiGatewayClient,
                                  CryptoService cryptoService,
                                  NotificationService notificationService,
                                  WorkspaceService workspaceService,
                                  ServiceHealthProbe healthProbe,
                                  AppProperties props,
                                  @Value("${app.maintenance.enabled:true}") boolean enabled) {
        this.platformRepository = platformRepository;
        this.userRepository = userRepository;
        this.platformProviderService = platformProviderService;
        this.aiGatewayClient = aiGatewayClient;
        this.cryptoService = cryptoService;
        this.notificationService = notificationService;
        this.workspaceService = workspaceService;
        this.healthProbe = healthProbe;
        this.aiBaseUrl = props.ai().baseUrl();
        this.enabled = enabled;
    }

    @Scheduled(fixedDelayString = "${app.maintenance.platform-provider-check-interval:PT30M}",
            initialDelayString = "${app.maintenance.initial-delay:PT2M}")
    public void checkPlatformProviders() {
        if (!enabled || !gatewayUp()) {
            return;
        }
        for (PlatformAiProvider provider : platformRepository.findByIsActiveTrue()) {
            try {
                var result = platformProviderService.test(provider.getId());
                if (!result.success()) {
                    log.warn("Platform provider '{}' check failed (auth={}); see last_error_code",
                            provider.getName(), result.authSuccess());
                }
            } catch (Exception ex) {
                log.error("Platform provider '{}' check errored: {}", provider.getName(), ex.toString());
            }
        }
    }

    @Scheduled(cron = "${app.maintenance.platform-voice-sync-cron:0 30 4 * * *}")
    public void syncPlatformVoices() {
        if (!enabled || !gatewayUp()) {
            return;
        }
        for (PlatformAiProvider provider : platformRepository.findByIsActiveTrue()) {
            if (!provider.hasCapability("TTS")) {
                continue;
            }
            try {
                int voices = platformProviderService.syncVoices(provider.getId());
                log.info("Platform provider '{}' voice sync: {} active voice(s)", provider.getName(), voices);
            } catch (Exception ex) {
                log.warn("Platform provider '{}' voice sync failed: {}", provider.getName(), ex.toString());
            }
        }
    }

    @Scheduled(cron = "${app.maintenance.user-provider-check-cron:0 0 4 * * *}")
    public void checkUserProviders() {
        if (!enabled || !gatewayUp()) {
            return;
        }
        for (UserAiProvider provider : userRepository.findByIsActiveTrue()) {
            try {
                checkUserProvider(provider);
            } catch (Exception ex) {
                log.warn("BYOK check of provider {} errored: {}", provider.getId(), ex.toString());
            }
        }
    }

    private void checkUserProvider(UserAiProvider provider) {
        boolean ok = aiGatewayClient.testConnection(provider.getProtocol(), provider.getBaseUrl(),
                cryptoService.decrypt(provider.getApiKeyEnc()));
        PlatformAiProvider.HealthStatus previous = provider.getHealthStatus();
        provider.setHealthStatus(ok ? PlatformAiProvider.HealthStatus.HEALTHY : PlatformAiProvider.HealthStatus.DOWN);
        provider.setLastErrorCode(ok ? null : "PROVIDER_AUTH_FAILED");
        provider.setLastCheckedAt(Instant.now());
        userRepository.save(provider);
        if (!ok && previous != PlatformAiProvider.HealthStatus.DOWN) {
            workspaceService.findDefaultWorkspaceIdForUser(provider.getUserId()).ifPresent(workspaceId ->
                    notificationService.notify(workspaceId, provider.getUserId(), "PROVIDER_KEY_INVALID",
                            provider.getId(), "Your AI provider key (" + provider.getApiKeyHint()
                                    + ") was rejected by the provider. Update it in Settings → AI providers."));
        }
    }

    private boolean gatewayUp() {
        boolean up = healthProbe.probe(aiBaseUrl).up();
        if (!up) {
            log.warn("Skipping provider checks: backend-ai is not reachable at {}", aiBaseUrl);
        }
        return up;
    }
}
