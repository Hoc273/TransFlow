package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.common.exception.AiStageException;
import com.app.modules.credit.service.CreditService;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.provider.service.ProviderHealthService;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.provider.service.ProviderUsageScope;
import com.app.modules.summarization.service.SummarizationService;
import com.app.modules.summarization.service.SummaryAiClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import javax.sound.sampled.AudioFileFormat;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * Mid-run failures of AI stages: provider quota / rate limit during TTS, credit running out,
 * resumable TTS and same-voice failover.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaStageResilienceTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private MediaAssetRepository assetRepository;
    @Mock private MediaStorageService storage;
    @Mock private ProviderResolverService providerResolver;
    @Mock private SummaryAiClient summaryAiClient;
    @Mock private SummarizationService summarizationService;
    @Mock private MediaCallbackService callbackService;
    @Mock private SubtitleSegmentRepository subtitleSegmentRepository;
    @Mock private CreditService creditService;
    @Mock private ProviderHealthService providerHealth;
    @Mock private MediaStageRecoveryService recoveryService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final UUID jobId = UUID.randomUUID();
    private final UUID stageId = UUID.randomUUID();
    private final UUID correlationId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();
    private MediaJob job;
    private MediaJobStage stage;
    private SubtitleSegment first;
    private SubtitleSegment second;
    private String wav;

    @BeforeEach
    void setUp() throws Exception {
        job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(workspaceId);
        job.setCreatedByUserId(userId);
        first = segment(1, "First sentence.");
        second = segment(2, "Second sentence.");
        stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(MediaJobStage.StageName.TTS);
        stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
        stage.setWorkerId(correlationId.toString());
        stage.setAttemptCount((short) 1);
        when(stageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(subtitleSegmentRepository.findByMediaJobIdOrderBySeq(jobId)).thenReturn(List.of(first, second));
        when(providerResolver.resolveForCapability(userId, "TTS")).thenReturn(
                new ProviderResolverService.ProviderResolution(UUID.randomUUID(), "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen3-omni-flash", true));
        when(storage.mediaBucket()).thenReturn("transflow-media");
        when(creditService.canAffordUsage(any(), any(), anyString(), anyLong(), anyBoolean())).thenReturn(true);
        when(creditService.chargeUsage(any(), any(), anyString(), anyLong(), anyBoolean())).thenReturn(BigDecimal.ONE);
        wav = Base64.getEncoder().encodeToString(wavBytes(3_000));
    }

    @Test
    void quotaRunningOutMidTtsFailsTheStageButKeepsAndBillsTheFinishedClips() {
        MockRestServiceServer server = expectTts(2, """
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000},
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_QUOTA_EXCEEDED"}],
                 "usage":{"characters":15},
                 "error_detail":{"errorCode":"PROVIDER_QUOTA_EXCEEDED","message":"Provider quota has been exhausted",
                   "retryable":false,"capability":"TTS"}}
                """.formatted(first.getId(), wav, second.getId()));

        pipeline(server).execute(message());

        server.verify(); // quota is not retried in later segment rounds
        verify(creditService).chargeUsage(workspaceId, userId, "TTS", 15L, true);
        assertNotNull(first.getTtsAudioRef());
        assertNotNull(first.getTtsClipKey());
        assertEquals(3_000L, first.getTtsDurationMs());
        assertNull(second.getTtsAudioRef());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(false), isNull(), anyString(), eq("PROVIDER_QUOTA_EXCEEDED"),
                argThat(detail -> detail.path("missingSegments").asInt() == 1
                        && detail.path("totalSegments").asInt() == 2), anyString());
    }

    @Test
    void ttsRerunOnlySynthesizesAndBillsTheMissingSegments() {
        keepClip(first, "First sentence.");
        MockRestServiceServer server = expectTts(1, """
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000}],
                 "usage":{"characters":16}}
                """.formatted(second.getId(), wav), second);

        pipeline(server).execute(message());

        server.verify();
        verify(creditService).chargeUsage(workspaceId, userId, "TTS", 16L, true);
        assertEquals("transflow-media/dubbed/old-first.wav", first.getTtsAudioRef());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(true), argThat(output -> output.path("success_count").asInt() == 2
                        && output.path("failure_count").asInt() == 0),
                isNull(), isNull(), isNull(), anyString());
    }

    @Test
    void editedSubtitleOrExpiredClipIsSynthesizedAgain() {
        keepClip(first, "Text before the edit.");
        keepClip(second, "Second sentence.");
        when(storage.objectMissing("transflow-media/dubbed/old-second.wav")).thenReturn(true);
        MockRestServiceServer server = expectTts(2, """
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000},
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000}],
                 "usage":{"characters":31}}
                """.formatted(first.getId(), wav, second.getId(), wav));

        pipeline(server).execute(message());

        server.verify();
        assertNotEquals("transflow-media/dubbed/old-first.wav", first.getTtsAudioRef());
    }

    @Test
    void insufficientCreditFailsBeforeAnyProviderCall() {
        when(creditService.canAffordUsage(any(), any(), eq("TTS"), anyLong(), anyBoolean())).thenReturn(false);
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

        pipeline(builder.build()).execute(message());

        server.verify(); // no TTS request was sent
        verify(creditService, never()).chargeUsage(any(), any(), anyString(), anyLong(), anyBoolean());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(false), isNull(), anyString(), eq("INSUFFICIENT_CREDIT"), any(), anyString());
    }

    @Test
    void rateLimitWithProgressFromAPooledProviderIsRetriedInTheSameAttempt() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/tts")).andRespond(withSuccess("""
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000},
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_RATE_LIMITED"}],
                 "usage":{"characters":15},
                 "error_detail":{"errorCode":"PROVIDER_RATE_LIMITED","message":"Provider rate limit has been reached",
                   "retryable":true}}
                """.formatted(first.getId(), wav, second.getId()), MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://ai.test/media/tts"))
                .andExpect(jsonPath("$.segments.length()").value(1))
                .andRespond(withSuccess("""
                        {"status":"COMPLETED","results":[
                          {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000}],
                         "usage":{"characters":16}}
                        """.formatted(second.getId(), wav), MediaType.APPLICATION_JSON));

        MediaStageExecutionService pipeline = pipeline(builder.build());
        pipeline.setProviderFailover(providerHealth, recoveryService);
        pipeline.execute(message());

        server.verify();
        verify(recoveryService, never()).deferRetry(any(), any(), any(), any(), any());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(true), any(), isNull(), isNull(), isNull(), anyString());
    }

    @Test
    void clipWithoutMeasurableDurationIsResynthesizedInsteadOfBreakingRender() {
        String unmeasuredMp3 = Base64.getEncoder().encodeToString(new byte[] {(byte) 0xFF, (byte) 0xF3, 0x60, 0x44});
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/tts")).andRespond(withSuccess("""
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000},
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s"}],
                 "usage":{"characters":31}}
                """.formatted(first.getId(), wav, second.getId(), unmeasuredMp3), MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://ai.test/media/tts"))
                .andExpect(jsonPath("$.segments.length()").value(1))
                .andExpect(jsonPath("$.segments[0].segment_id").value(second.getId().toString()))
                .andRespond(withSuccess("""
                        {"status":"COMPLETED","results":[
                          {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3000}],
                         "usage":{"characters":16}}
                        """.formatted(second.getId(), wav), MediaType.APPLICATION_JSON));

        pipeline(builder.build()).execute(message());

        server.verify();
        assertEquals(3_000L, second.getTtsDurationMs());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(true), any(), isNull(), isNull(), isNull(), anyString());
    }

    @Test
    void gatewayReadTimeoutIsReportedAsProviderTimeout() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        // Spring 6.1 JdkClientHttpRequest surfaces a read timeout as IOException(TimeoutException).
        server.expect(requestTo("http://ai.test/media/tts")).andRespond(request -> {
            throw new java.io.IOException("Request timed out", new java.util.concurrent.TimeoutException());
        });

        pipeline(builder.build()).execute(message());

        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(false), isNull(), anyString(), eq("PROVIDER_TIMEOUT"), any(), anyString());
    }

    @Test
    void rateLimitedTtsIsDeferredWithTheProviderRetryAfter() {
        when(recoveryService.deferRetry(any(), any(), any(), any(), any())).thenReturn(true);
        MockRestServiceServer server = expectTts(2, """
                {"status":"FAILED","results":[
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_RATE_LIMITED"},
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_RATE_LIMITED"}],
                 "error":"All segments failed TTS synthesis",
                 "error_detail":{"errorCode":"PROVIDER_RATE_LIMITED","message":"Provider rate limit has been reached",
                   "retryable":true,"details":{"retryAfterSeconds":"42"}}}
                """.formatted(first.getId(), second.getId()));

        MediaStageExecutionService pipeline = pipeline(server);
        pipeline.setProviderFailover(providerHealth, recoveryService);
        pipeline.execute(message());

        server.verify(); // no immediate segment retry rounds against a rate limit
        verify(recoveryService).deferRetry(jobId, stageId, correlationId.toString(), "PROVIDER_RATE_LIMITED",
                Duration.ofSeconds(42));
        verify(callbackService, never()).completeStage(any(), any(), any(), anyBoolean(), any(), any(), any(), any(), any());
    }

    @Test
    void ttsFailsOverToAnotherKeyServingTheSameVoice() {
        UUID ttsProviderId = UUID.randomUUID();
        UUID voiceRowId = UUID.randomUUID();
        job.setTtsProviderId(ttsProviderId);
        job.setTtsVoiceId(voiceRowId);
        when(providerResolver.resolveVoiceIdentifier(userId, ttsProviderId, voiceRowId)).thenReturn(Optional.of("Cherry"));
        when(providerResolver.resolveBoundProvider(userId, ttsProviderId, "TTS", "Cherry")).thenAnswer(inv -> {
            ProviderUsageScope.recordResolution("TTS", ttsProviderId, true);
            return new ProviderResolverService.ProviderResolution(ttsProviderId, "dashscope_native",
                    "https://dashscope.example/api", "secret", "qwen3-omni-flash", false);
        });
        when(providerHealth.reportScopeFailure("PROVIDER_QUOTA_EXCEEDED")).thenReturn(true);
        when(providerResolver.hasVoiceSibling(ttsProviderId, "Cherry")).thenReturn(true);
        when(recoveryService.retryOnAnotherProvider(any(), any(), any(), any())).thenReturn(true);
        MockRestServiceServer server = expectTts(2, """
                {"status":"FAILED","results":[
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_QUOTA_EXCEEDED"},
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_QUOTA_EXCEEDED"}],
                 "error":"All segments failed TTS synthesis",
                 "error_detail":{"errorCode":"PROVIDER_QUOTA_EXCEEDED","message":"Provider quota has been exhausted",
                   "retryable":false}}
                """.formatted(first.getId(), second.getId()));

        MediaStageExecutionService pipeline = pipeline(server);
        pipeline.setProviderFailover(providerHealth, recoveryService);
        pipeline.execute(message());

        verify(recoveryService).retryOnAnotherProvider(jobId, stageId, correlationId.toString(), "PROVIDER_QUOTA_EXCEEDED");
        verify(callbackService, never()).completeStage(any(), any(), any(), anyBoolean(), any(), any(), any(), any(), any());
    }

    @Test
    void ttsWithoutASameVoiceKeyIsNotFailedOver() {
        UUID ttsProviderId = UUID.randomUUID();
        UUID voiceRowId = UUID.randomUUID();
        job.setTtsProviderId(ttsProviderId);
        job.setTtsVoiceId(voiceRowId);
        when(providerResolver.resolveVoiceIdentifier(userId, ttsProviderId, voiceRowId)).thenReturn(Optional.of("Cherry"));
        when(providerResolver.resolveBoundProvider(userId, ttsProviderId, "TTS", "Cherry")).thenAnswer(inv -> {
            ProviderUsageScope.recordResolution("TTS", ttsProviderId, true);
            return new ProviderResolverService.ProviderResolution(ttsProviderId, "dashscope_native",
                    "https://dashscope.example/api", "secret", "qwen3-omni-flash", false);
        });
        when(providerHealth.reportScopeFailure("PROVIDER_QUOTA_EXCEEDED")).thenReturn(true);
        when(providerResolver.hasVoiceSibling(ttsProviderId, "Cherry")).thenReturn(false);
        MockRestServiceServer server = expectTts(2, """
                {"status":"FAILED","results":[],
                 "error_detail":{"errorCode":"PROVIDER_QUOTA_EXCEEDED","message":"Provider quota has been exhausted",
                   "retryable":false}}
                """);

        MediaStageExecutionService pipeline = pipeline(server);
        pipeline.setProviderFailover(providerHealth, recoveryService);
        pipeline.execute(message());

        verify(recoveryService, never()).retryOnAnotherProvider(any(), any(), any(), any());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(false), isNull(), anyString(), eq("PROVIDER_QUOTA_EXCEEDED"), any(), anyString());
    }

    @Test
    void retryDelayFollowsRetryAfterWithinBoundsElseBacksOff() {
        assertEquals(Duration.ofSeconds(15), MediaStageExecutionService.retryDelay(rateLimited("2"), 1));
        assertEquals(Duration.ofSeconds(300), MediaStageExecutionService.retryDelay(rateLimited("9999"), 1));
        assertEquals(Duration.ofSeconds(30), MediaStageExecutionService.retryDelay(rateLimited(null), 1));
        assertEquals(Duration.ofSeconds(120), MediaStageExecutionService.retryDelay(rateLimited(null), 3));
        assertEquals(Duration.ofSeconds(300), MediaStageExecutionService.retryDelay(rateLimited(null), 9));
    }

    @Test
    void clipKeyChangesWithVoiceTextAndProtocol() {
        String key = MediaStageExecutionService.ttsClipKey("openai_compatible", "nova", "Hello");
        assertEquals(64, key.length());
        assertEquals(key, MediaStageExecutionService.ttsClipKey("OPENAI_COMPATIBLE", "nova", "Hello"));
        assertNotEquals(key, MediaStageExecutionService.ttsClipKey("openai_compatible", "alloy", "Hello"));
        assertNotEquals(key, MediaStageExecutionService.ttsClipKey("openai_compatible", "nova", "Hello!"));
        assertNotEquals(key, MediaStageExecutionService.ttsClipKey("azure_speech", "nova", "Hello"));
    }

    private AiStageException rateLimited(String retryAfter) {
        AiStageException failure = AiStageException.safeFailure("PROVIDER_RATE_LIMITED", "limited", true, null, "TTS", null);
        return retryAfter == null ? failure : failure.withDetail(Map.of("details", Map.of("retryAfterSeconds", retryAfter)));
    }

    private void keepClip(SubtitleSegment segment, String clipText) {
        segment.setTtsAudioRef("transflow-media/dubbed/old-" + (segment == first ? "first" : "second") + ".wav");
        segment.setTtsClipKey(MediaStageExecutionService.ttsClipKey("dashscope_native", "default", clipText));
        segment.setTtsDurationMs(2_500L);
    }

    private MockRestServiceServer expectTts(int segments, String response, SubtitleSegment... only) {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        var expectation = server.expect(requestTo("http://ai.test/media/tts"))
                .andExpect(jsonPath("$.segments.length()").value(segments));
        if (only.length == 1) {
            expectation = expectation.andExpect(jsonPath("$.segments[0].segment_id").value(only[0].getId().toString()));
        }
        expectation.andRespond(withSuccess(response, MediaType.APPLICATION_JSON));
        this.aiClient = builder.build();
        return server;
    }

    private RestClient aiClient;

    private MediaStageExecutionService pipeline(MockRestServiceServer ignored) {
        return pipeline(aiClient);
    }

    private MediaStageExecutionService pipeline(RestClient client) {
        MediaStageExecutionService pipeline = new MediaStageExecutionService(jobRepository, stageRepository,
                assetRepository, storage, providerResolver, summaryAiClient, summarizationService, callbackService,
                objectMapper, new AppProperties(null, null, null, null, null, null),
                client, RestClient.builder().baseUrl("http://worker.test").build(),
                subtitleSegmentRepository, null, creditService, null, null);
        pipeline.setTtsSegmentRetryDelayMs(0L);
        return pipeline;
    }

    private MediaStageMessage message() {
        return new MediaStageMessage(jobId, stageId, "TTS", correlationId, (short) 1);
    }

    private SubtitleSegment segment(int seq, String text) {
        SubtitleSegment segment = new SubtitleSegment();
        segment.setId(UUID.randomUUID());
        segment.setMediaJobId(jobId);
        segment.setSeq(seq);
        segment.setTargetText(text);
        segment.setStartMs((seq - 1) * 2_000L);
        segment.setEndMs(seq * 2_000L);
        return segment;
    }

    private byte[] wavBytes(long durationMs) throws Exception {
        AudioFormat format = new AudioFormat(8_000f, 16, 1, true, false);
        int frames = (int) (8_000L * durationMs / 1_000L);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        AudioSystem.write(new AudioInputStream(new ByteArrayInputStream(new byte[frames * 2]), format, frames),
                AudioFileFormat.Type.WAVE, out);
        return out.toByteArray();
    }
}
