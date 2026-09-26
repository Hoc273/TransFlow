package com.app.common.config;

import com.app.modules.media_job.pipeline.dto.ExtractAudioRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RestClientConfigTest {

    @Test
    void mediaWorkerClientPostsExtractRequestOverHttp11() throws Exception {
        AtomicReference<String> protocol = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> internalToken = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/media/extract-audio", exchange -> {
            protocol.set(exchange.getProtocol());
            internalToken.set(exchange.getRequestHeaders().getFirst(RestClientConfig.INTERNAL_TOKEN_HEADER));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"correlation_id\":\"correlation\",\"status\":\"ACCEPTED\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(202, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            AppProperties props = new AppProperties(
                    null, null, null, null, null, null,
                    new AppProperties.MediaWorker(baseUrl, null, null),
                    null,
                    new AppProperties.Ai("http://localhost:8000", 5000, 30000, 3),
                    null);
            SecurityProperties security = new SecurityProperties(false, false, "internal-token-123", null, null, null);
            RestClient client = new RestClientConfig(security).mediaWorkerRestClient(props);

            var response = client.post()
                    .uri("/internal/media/extract-audio")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new ExtractAudioRequest("correlation", "job", "stage", "bucket/video.mp4"))
                    .retrieve()
                    .toBodilessEntity();

            assertEquals(202, response.getStatusCode().value());
            assertEquals("HTTP/1.1", protocol.get());
            assertEquals("internal-token-123", internalToken.get());
            JsonNode json = new ObjectMapper().readTree(requestBody.get());
            assertEquals("correlation", json.path("correlation_id").asText());
            assertEquals("job", json.path("media_job_id").asText());
            assertEquals("stage", json.path("stage_id").asText());
            assertEquals("bucket/video.mp4", json.path("source_video_ref").asText());
        } finally {
            server.stop(0);
        }
    }
}
