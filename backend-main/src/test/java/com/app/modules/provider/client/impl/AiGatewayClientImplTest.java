package com.app.modules.provider.client.impl;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class AiGatewayClientImplTest {

    private MockRestServiceServer server;
    private AiGatewayClientImpl client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new AiGatewayClientImpl(builder.build());
    }

    @Test
    void authProbeReadsFastApiOkField() {
        server.expect(requestTo("http://ai.test/ai/validate/auth"))
                .andRespond(withSuccess("{\"ok\":true,\"duration_ms\":3}", MediaType.APPLICATION_JSON));

        assertThat(client.testConnection("openai_compatible", "https://provider.test/v1", "secret"))
                .isTrue();
        server.verify();
    }

    @Test
    void voiceDiscoveryUsesProviderPayloadModelField() {
        server.expect(requestTo("http://ai.test/media/tts/voices"))
                .andExpect(content().json("""
                        {
                          "protocol":"openai_compatible",
                          "base_url":"https://provider.test/v1",
                          "api_key":"secret",
                          "capabilities":["TTS"],
                          "model":"tts-1"
                        }
                        """))
                .andRespond(withSuccess("""
                        {"protocol":"openai_compatible","discovery_mode":"STATIC","voices":[]}
                        """, MediaType.APPLICATION_JSON));

        assertThat(client.fetchTtsVoices(
                "openai_compatible", "https://provider.test/v1", "secret", "tts-1"))
                .isEmpty();
        server.verify();
    }
}
