package com.app.modules.provider.runner;

import com.app.modules.provider.dto.CreatePlatformAiProviderRequest;
import com.app.modules.provider.repository.PlatformAiProviderRepository;
import com.app.modules.provider.service.PlatformProviderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;

/**
 * Registers the self-hosted FreeLLMAPI proxy as a FREE platform pool key on startup when
 * {@code FREELLMAPI_API_KEY} is set. Create-only: once the row exists it is managed from
 * Super Admin → AI providers and this runner never overwrites it.
 */
@Component
@Order(110)
public class FreeLlmApiSeedRunner implements ApplicationRunner {

    static final String NAME = "FreeLLMAPI";
    private static final Logger log = LoggerFactory.getLogger(FreeLlmApiSeedRunner.class);

    private final PlatformAiProviderRepository repository;
    private final PlatformProviderService providerService;
    private final String apiKey;
    private final String baseUrl;
    private final String model;
    private final String capabilities;
    private final int priority;

    public FreeLlmApiSeedRunner(PlatformAiProviderRepository repository,
                                PlatformProviderService providerService,
                                @Value("${app.freellmapi.api-key:}") String apiKey,
                                @Value("${app.freellmapi.base-url:http://freellmapi:3001/v1}") String baseUrl,
                                @Value("${app.freellmapi.model:auto}") String model,
                                @Value("${app.freellmapi.capabilities:TRANSLATE}") String capabilities,
                                @Value("${app.freellmapi.priority:10}") int priority) {
        this.repository = repository;
        this.providerService = providerService;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.model = model;
        this.capabilities = capabilities;
        this.priority = priority;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (apiKey == null || apiKey.isBlank()) {
            log.debug("FreeLLMAPI seed skipped (FREELLMAPI_API_KEY empty)");
            return;
        }
        if (repository.existsByNameIgnoreCase(NAME)) {
            log.debug("FreeLLMAPI platform provider already registered");
            return;
        }
        List<String> caps = Arrays.stream(capabilities.split(","))
                .map(String::trim).filter(c -> !c.isEmpty()).toList();
        try {
            providerService.create(new CreatePlatformAiProviderRequest(NAME, "openai_compatible", caps,
                    baseUrl, apiKey, model, priority, 1, "FREE", true));
            log.info("Registered FreeLLMAPI as platform provider (capabilities={}, model={}, priority={})",
                    caps, model, priority);
        } catch (Exception ex) {
            log.error("FreeLLMAPI seed failed: {}", ex.toString());
        }
    }
}
