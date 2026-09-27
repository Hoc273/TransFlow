package com.app.modules.media_job.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Billing units must match the unit each price row is defined in (Credit_Coefficient_Calculation §4.2). */
class MediaStageUsageUnitsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonNode usage(String json) throws Exception {
        return MAPPER.readTree("{\"usage\":" + json + "}");
    }

    @Test
    void stt_isBilledInAudioSeconds_evenWhenProviderReportsTokens() throws Exception {
        assertEquals(600L, MediaStageExecutionService.usageUnits(
                usage("{\"total_tokens\":9000,\"audio_seconds\":600.4}"), "STT", 600_400L));
    }

    @Test
    void stt_withoutAudioSeconds_fallsBackToAssetDurationInSeconds() throws Exception {
        assertEquals(600L, MediaStageExecutionService.usageUnits(
                usage("{\"total_tokens\":9000}"), "STT", 600_400L));
        assertEquals(1L, MediaStageExecutionService.usageUnits(null, "STT", 800L));
    }

    @Test
    void llm_isBilledInTokens() throws Exception {
        assertEquals(5000L, MediaStageExecutionService.usageUnits(
                usage("{\"input_tokens\":3000,\"output_tokens\":2000}"), "TRANSLATE", 12_000L));
    }

    @Test
    void tts_isBilledInCharacters() throws Exception {
        assertEquals(10_000L, MediaStageExecutionService.usageUnits(
                usage("{\"characters\":10000}"), "TTS", 1L));
    }
}
