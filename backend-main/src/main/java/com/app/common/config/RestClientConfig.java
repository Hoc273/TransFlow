package com.app.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

/** Shared HTTP/1.1 clients for the internal AI gateway and media worker. */
@Configuration
public class RestClientConfig {

    private static final Duration MEDIA_WORKER_CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration MEDIA_WORKER_READ_TIMEOUT = Duration.ofSeconds(30);

    @Bean("mediaWorkerRestClient")
    public RestClient mediaWorkerRestClient(AppProperties props) {
        return RestClient.builder()
                .baseUrl(props.mediaWorker().baseUrl())
                .requestFactory(createHttp11Factory(
                        MEDIA_WORKER_CONNECT_TIMEOUT, MEDIA_WORKER_READ_TIMEOUT))
                .build();
    }

    @Bean("aiRestClient")
    public RestClient aiRestClient(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        return RestClient.builder()
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
        return RestClient.builder()
                .baseUrl(ai.baseUrl())
                .requestFactory(createHttp11Factory(
                        Duration.ofMillis(ai.connectTimeoutMs()), Duration.ofMinutes(10)))
                .build();
    }

    /** Separation can exceed the STT/TTS budget while processing long source audio. */
    @Bean("sourceSeparationAiRestClient")
    public RestClient sourceSeparationAiRestClient(AppProperties props) {
        AppProperties.Ai ai = props.ai();
        return RestClient.builder()
                .baseUrl(ai.baseUrl())
                .requestFactory(createHttp11Factory(
                        Duration.ofMillis(ai.connectTimeoutMs()), Duration.ofMinutes(16)))
                .build();
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
