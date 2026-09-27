package com.app.common.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

/**
 * Shared HTTP/1.1 clients for the internal AI gateway and media worker. Every call carries
 * {@value #INTERNAL_TOKEN_HEADER} so those services reject requests that don't come from
 * backend-main (they hold no user auth of their own).
 */
@Configuration
public class RestClientConfig {

    public static final String INTERNAL_TOKEN_HEADER = "X-Internal-Token";

    private static final Duration MEDIA_WORKER_CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration MEDIA_WORKER_READ_TIMEOUT = Duration.ofSeconds(30);

    private final String internalServiceToken;

    @Autowired
    public RestClientConfig(SecurityProperties securityProperties) {
        this.internalServiceToken = securityProperties.internalServiceToken();
    }

    /** For unit tests that build clients without a Spring context. */
    public RestClientConfig() {
        this.internalServiceToken = null;
    }

    @Bean("mediaWorkerRestClient")
    public RestClient mediaWorkerRestClient(AppProperties props) {
        return internalClient()
                .baseUrl(props.mediaWorker().baseUrl())
                .requestFactory(createHttp11Factory(
                        MEDIA_WORKER_CONNECT_TIMEOUT, MEDIA_WORKER_READ_TIMEOUT))
                .build();
    }

    @Bean("aiRestClient")
    public RestClient aiRestClient(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        return internalClient()
                .baseUrl(ai.baseUrl())
                .requestFactory(createHttp11Factory(
                        Duration.ofMillis(ai.connectTimeoutMs()),
                        Duration.ofMillis(ai.readTimeoutMs())))
                .build();
    }

    /** Long-running AI media operations such as STT and TTS can run for several minutes. */
    @Bean("mediaAiRestClient")
    public RestClient mediaAiRestClient(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        return internalClient()
                .baseUrl(ai.baseUrl())
                .requestFactory(createHttp11Factory(
                        Duration.ofMillis(ai.connectTimeoutMs()), Duration.ofMinutes(10)))
                .build();
    }

    /** Separation can exceed the STT/TTS budget while processing long source audio. */
    @Bean("sourceSeparationAiRestClient")
    public RestClient sourceSeparationAiRestClient(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        return internalClient()
                .baseUrl(ai.baseUrl())
                .requestFactory(createHttp11Factory(
                        Duration.ofMillis(ai.connectTimeoutMs()), Duration.ofMinutes(16)))
                .build();
    }

    private RestClient.Builder internalClient() {
        RestClient.Builder builder = RestClient.builder();
        if (internalServiceToken != null && !internalServiceToken.isBlank()) {
            builder.defaultHeader(INTERNAL_TOKEN_HEADER, internalServiceToken);
        }
        return builder;
    }

    private JdkClientHttpRequestFactory createHttp11Factory(Duration connectTimeout, Duration readTimeout) {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(connectTimeout)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(readTimeout);
        return factory;
    }
}
