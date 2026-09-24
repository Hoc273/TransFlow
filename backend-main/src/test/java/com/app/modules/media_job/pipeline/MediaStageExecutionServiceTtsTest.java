package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.summarization.service.SummarizationService;
import com.app.modules.summarization.service.SummaryAiClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
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
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaStageExecutionServiceTtsTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private MediaAssetRepository assetRepository;
    @Mock private MediaStorageService storage;
    @Mock private ProviderResolverService providerResolver;
    @Mock private SummaryAiClient summaryAiClient;
    @Mock private SummarizationService summarizationService;
    @Mock private MediaCallbackService callbackService;
    @Mock private SubtitleSegmentRepository subtitleSegmentRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final UUID jobId = UUID.randomUUID();
    private final UUID stageId = UUID.randomUUID();
    private final UUID correlationId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID assetId = UUID.randomUUID();
    private MediaJob job;
    private SubtitleSegment first;
    private SubtitleSegment second;

    @BeforeEach
    void setUp() {
        job = new MediaJob();
        job.setId(jobId);
        job.setCreatedByUserId(userId);
        job.setRootAssetId(assetId);
        first = segment(1, "First sentence.", 0, 2_000);
        second = segment(2, "Second sentence.", 2_000, 4_000);
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(subtitleSegmentRepository.findByMediaJobIdOrderBySeq(jobId)).thenReturn(List.of(first, second));
        when(providerResolver.resolveForCapability(userId, "TTS")).thenReturn(
                new ProviderResolverService.ProviderResolution(UUID.randomUUID(), "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen3-omni-flash", true));
        when(storage.mediaBucket()).thenReturn("transflow-media");
    }

    @Test
    void ttsSynthesizesEachSubtitleSegmentAndRetriesOnlyFailedSegments() throws Exception {
        stage(MediaJobStage.StageName.TTS);
        String wav = Base64.getEncoder().encodeToString(wavBytes(3_000));
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/tts")).andExpect(method(POST))
                .andExpect(jsonPath("$.segments.length()").value(2))
                .andExpect(jsonPath("$.segments[0].segment_id").value(first.getId().toString()))
                .andExpect(jsonPath("$.segments[0].target_text").value("First sentence."))
                .andRespond(withSuccess("""
                        {"status":"COMPLETED","results":[
                          {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s"},
                          {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_RESPONSE_MALFORMED"}],
                         "usage":{"characters":15}}
                        """.formatted(first.getId(), wav, second.getId()), MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://ai.test/media/tts")).andExpect(method(POST))
                .andExpect(jsonPath("$.segments.length()").value(1))
                .andExpect(jsonPath("$.segments[0].segment_id").value(second.getId().toString()))
                .andRespond(withSuccess("""
                        {"status":"COMPLETED","results":[
                          {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s"}],
                         "usage":{"characters":16}}
                        """.formatted(second.getId(), wav), MediaType.APPLICATION_JSON));

        pipeline(builder.build()).execute(message("TTS"));

        server.verify();
        assertNotNull(first.getTtsAudioRef());
        assertTrue(first.getTtsAudioRef().startsWith("transflow-media/dubbed/" + jobId + "/" + first.getId()));
        assertTrue(first.getTtsAudioRef().endsWith(".wav"));
        assertNotNull(second.getTtsAudioRef());
        verify(storage, times(2)).putMediaObject(anyString(), any(), anyLong(), eq("audio/wav"));
        verify(subtitleSegmentRepository).saveAll(List.of(first, second));
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(true), argThat(output -> output.path("success_count").asInt() == 2
                        && output.path("failure_count").asInt() == 0
                        && output.path("segments").size() == 2
                        && output.path("segments").get(1).path("start_ms").asLong() == 2_000
                        && output.path("segments").get(0).path("duration_ms").asLong() == 3_000),
                isNull(), isNull(), isNull(), argThat(key -> key.startsWith("internal:")));
    }

    @Test
    void ttsFailsStageWithoutRetryingNonRetryableProviderFailure() {
        stage(MediaJobStage.StageName.TTS);
        String failed = """
                {"status":"FAILED","results":[
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_AUTH_FAILED"},
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_AUTH_FAILED"}],
                 "error":"All segments failed TTS synthesis",
                 "error_detail":{"errorCode":"PROVIDER_AUTH_FAILED","message":"Invalid API key",
                   "retryable":false,"protocol":"dashscope_native","capability":"TTS"}}
                """.formatted(first.getId(), second.getId());
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/tts"))
                .andRespond(withSuccess(failed, MediaType.APPLICATION_JSON));

        pipeline(builder.build()).execute(message("TTS"));

        server.verify();
        verify(subtitleSegmentRepository, never()).saveAll(any());
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(false), isNull(), eq("Invalid API key"), eq("PROVIDER_AUTH_FAILED"), any(), argThat(key -> key.startsWith("internal:")));
    }

    @Test
    void audioMixPlacesEachTtsClipOnItsSubtitleWindow() {
        stage(MediaJobStage.StageName.AUDIO_MIX);
        first.setTtsAudioRef("transflow-media/dubbed/a.wav");
        second.setTtsAudioRef("transflow-media/dubbed/b.wav");
        MediaAsset asset = new MediaAsset();
        asset.setBucketName("transflow-media");
        asset.setObjectStorageKey("source.mp4");
        asset.setDurationMs(4_000L);
        when(assetRepository.findById(assetId)).thenReturn(Optional.of(asset));
        MediaJobStage separation = new MediaJobStage();
        separation.setOutputRef("{\"stems\":[{\"role\":\"MUSIC\",\"objectRef\":\"transflow-media/music.wav\"}]}");
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SOURCE_SEPARATION))
                .thenReturn(Optional.of(separation));
        MediaJobStage tts = new MediaJobStage();
        tts.setOutputRef("{\"segments\":[{\"segment_id\":\"%s\",\"duration_ms\":2400}]}".formatted(first.getId()));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.TTS))
                .thenReturn(Optional.of(tts));

        RestClient.Builder workerBuilder = RestClient.builder().baseUrl("http://worker.test");
        MockRestServiceServer worker = MockRestServiceServer.bindTo(workerBuilder).build();
        worker.expect(requestTo("http://worker.test/internal/media/audio-mix"))
                .andExpect(jsonPath("$.mix_plan.inputs.length()").value(3))
                .andExpect(jsonPath("$.mix_plan.inputs[1].segment_id").value(first.getId().toString()))
                .andExpect(jsonPath("$.mix_plan.inputs[1].tempo").value(1.2))
                .andExpect(jsonPath("$.mix_plan.inputs[2].start_ms").value(2_000))
                .andExpect(jsonPath("$.mix_plan.inputs[2].end_ms").value(4_000))
                .andExpect(jsonPath("$.mix_plan.inputs[2].tempo").doesNotExist())
                .andExpect(jsonPath("$.mix_plan.ducking.speech_input_ids.length()").value(2))
                .andRespond(withSuccess());

        new MediaStageExecutionService(jobRepository, stageRepository, assetRepository, storage,
                providerResolver, summaryAiClient, summarizationService, callbackService, objectMapper,
                new AppProperties(null, null, null, null, null, null),
                RestClient.builder().baseUrl("http://ai.test").build(), workerBuilder.build(),
                subtitleSegmentRepository, null, null, null, null).execute(message("AUDIO_MIX"));

        worker.verify();
        verify(callbackService, never()).completeStage(any(), any(), any(), eq(false), any(), any(), any(), any(), any());
    }

    @Test
    void cancelDuringTtsStopsBeforeTheNextProviderBatch() throws Exception {
        MediaJobStage processing = stage(MediaJobStage.StageName.TTS);
        MediaJobStage cancelled = new MediaJobStage();
        cancelled.setId(stageId);
        cancelled.setMediaJobId(jobId);
        cancelled.setStageName(MediaJobStage.StageName.TTS);
        cancelled.setStatus(MediaJobStage.StageStatus.CANCEL_REQUESTED);
        cancelled.setWorkerId(correlationId.toString());
        // Delivery check + first batch see PROCESSING; the user cancels before the retry round.
        when(stageRepository.findById(stageId)).thenReturn(Optional.of(processing), Optional.of(processing),
                Optional.of(cancelled));
        String wav = Base64.getEncoder().encodeToString(wavBytes(1_000));
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/tts")).andRespond(withSuccess("""
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s"},
                  {"segment_id":"%s","status":"FAILED","errorCode":"PROVIDER_RESPONSE_MALFORMED"}]}
                """.formatted(first.getId(), wav, second.getId()), MediaType.APPLICATION_JSON));

        pipeline(builder.build()).execute(message("TTS"));

        server.verify(); // exactly one provider call: the retry round never started
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(false), isNull(), isNull(), isNull(), isNull(), eq("internal:" + correlationId + ":complete"));
    }

    @Test
    void cancelRequestedBeforeDeliveryIsFinalizedInsteadOfLeftHanging() {
        stage(MediaJobStage.StageName.STT).setStatus(MediaJobStage.StageStatus.CANCEL_REQUESTED);
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

        pipeline(builder.build()).execute(message("STT"));

        server.verify(); // no AI call for a cancelled attempt
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.STT),
                eq(false), isNull(), isNull(), isNull(), isNull(), eq("internal:" + correlationId + ":complete"));
    }

    @Test
    void ttsKeepsGatewayMeasuredDurationForNonWavClips() {
        stage(MediaJobStage.StageName.TTS);
        String mp3 = Base64.getEncoder().encodeToString(new byte[] {'I', 'D', '3', 4, 0, 0, 0, 0, 0, 0});
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/tts")).andRespond(withSuccess("""
                {"status":"COMPLETED","results":[
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":2345},
                  {"segment_id":"%s","status":"SUCCESS","audio_base64":"%s","duration_ms":3456}]}
                """.formatted(first.getId(), mp3, second.getId(), mp3), MediaType.APPLICATION_JSON));

        pipeline(builder.build()).execute(message("TTS"));

        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TTS),
                eq(true), argThat(output -> output.path("segments").get(0).path("duration_ms").asLong() == 2345
                        && output.path("segments").get(1).path("duration_ms").asLong() == 3456), isNull(),
                isNull(), isNull(), argThat(key -> key.startsWith("internal:")));
    }

    @Test
    void narratedSummaryRenderIsTimedByMeasuredTtsNotBySourceFootage() {
        stage(MediaJobStage.StageName.RENDER);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setOutputAudioMode(MediaJob.OutputAudioMode.DUB_REPLACE);
        second.setStartMs(10_000);
        second.setEndMs(30_000);
        first.setTtsAudioRef("transflow-media/dubbed/a.wav");
        second.setTtsAudioRef("transflow-media/dubbed/b.mp3");
        renderSource(40_000L);
        ttsOutput(2_400L, 5_000L);
        ArgumentCaptor<InputStream> subtitle = ArgumentCaptor.forClass(InputStream.class);

        RestClient.Builder workerBuilder = RestClient.builder().baseUrl("http://worker.test");
        MockRestServiceServer worker = MockRestServiceServer.bindTo(workerBuilder).build();
        worker.expect(requestTo("http://worker.test/internal/media/render"))
                .andExpect(jsonPath("$.generative_beats.length()").value(2))
                .andExpect(jsonPath("$.generative_beats[1].source_start_ms").value(10_000))
                .andExpect(jsonPath("$.generative_beats[1].source_end_ms").value(30_000))
                .andExpect(jsonPath("$.generative_beats[1].tts_duration_ms").value(5_000))
                .andExpect(jsonPath("$.generative_beats[1].audio_ref").value("transflow-media/dubbed/b.mp3"))
                .andExpect(jsonPath("$.generative_beats[1].tempo").doesNotExist()) // no requested duration
                .andExpect(jsonPath("$.cut_ranges[1].start_ms").value(2_400))
                .andExpect(jsonPath("$.cut_ranges[1].end_ms").value(7_400))
                .andRespond(withSuccess());

        renderPipeline(workerBuilder.build()).execute(message("RENDER"));

        worker.verify();
        verify(storage).putMediaObject(startsWith("subtitles/"), subtitle.capture(), anyLong(), anyString());
        String srt = new String(readAll(subtitle.getValue()), StandardCharsets.UTF_8);
        assertTrue(srt.contains("00:00:00,000 --> 00:00:02,400"), srt);
        assertTrue(srt.contains("00:00:02,400 --> 00:00:07,400"), srt);
    }

    @Test
    void narrationLongerThanRequestedIsSpedUpWithinTheNaturalTempoBound() {
        stage(MediaJobStage.StageName.RENDER);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setOutputAudioMode(MediaJob.OutputAudioMode.DUB_REPLACE);
        job.setRequestedDurationSeconds(7);
        first.setTtsAudioRef("transflow-media/dubbed/a.wav");
        second.setTtsAudioRef("transflow-media/dubbed/b.wav");
        renderSource(40_000L);
        ttsOutput(2_400L, 5_000L); // 7.4 s of narration for a 7 s target: +5.7 %

        RestClient.Builder workerBuilder = RestClient.builder().baseUrl("http://worker.test");
        MockRestServiceServer worker = MockRestServiceServer.bindTo(workerBuilder).build();
        worker.expect(requestTo("http://worker.test/internal/media/render"))
                .andExpect(jsonPath("$.generative_beats[0].tempo").value(1.057))
                .andExpect(jsonPath("$.generative_beats[1].tempo").value(1.057))
                .andExpect(jsonPath("$.generative_beats[1].tts_duration_ms").value(4_730))
                .andExpect(jsonPath("$.cut_ranges[1].end_ms").value(7_001))
                .andRespond(withSuccess());

        renderPipeline(workerBuilder.build()).execute(message("RENDER"));

        worker.verify();
    }

    @Test
    void narrationFarFromTheTargetIsOnlyRetimedUpToTheBound() {
        stage(MediaJobStage.StageName.RENDER);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setOutputAudioMode(MediaJob.OutputAudioMode.DUB_REPLACE);
        job.setRequestedDurationSeconds(12);
        first.setTtsAudioRef("transflow-media/dubbed/a.wav");
        second.setTtsAudioRef("transflow-media/dubbed/b.wav");
        renderSource(40_000L);
        ttsOutput(2_400L, 5_000L); // 7.4 s for 12 s: slowing to 0.9x keeps speech natural

        RestClient.Builder workerBuilder = RestClient.builder().baseUrl("http://worker.test");
        MockRestServiceServer worker = MockRestServiceServer.bindTo(workerBuilder).build();
        worker.expect(requestTo("http://worker.test/internal/media/render"))
                .andExpect(jsonPath("$.generative_beats[0].tempo").value(0.9))
                .andExpect(jsonPath("$.generative_beats[0].tts_duration_ms").value(2_667))
                .andRespond(withSuccess());

        renderPipeline(workerBuilder.build()).execute(message("RENDER"));

        worker.verify();
    }

    @Test
    void narratedSummaryRenderFailsClearlyWhenANarrationClipIsMissing() {
        stage(MediaJobStage.StageName.RENDER);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setOutputAudioMode(MediaJob.OutputAudioMode.DUB_REPLACE);
        first.setTtsAudioRef("transflow-media/dubbed/a.wav");
        renderSource(40_000L);
        ttsOutput(2_400L, null);

        renderPipeline(RestClient.builder().baseUrl("http://worker.test").build()).execute(message("RENDER"));

        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.RENDER),
                eq(false), isNull(), anyString(), eq("TTS_SEGMENTS_INCOMPLETE"), any(), argThat(key -> key.startsWith("internal:")));
    }

    @Test
    void originalAudioSummaryMapsSubtitlesOntoTheConcatenatedCuts() {
        stage(MediaJobStage.StageName.RENDER);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        job.setOutputAudioMode(MediaJob.OutputAudioMode.ORIGINAL_ONLY);
        second.setStartMs(10_000);
        second.setEndMs(12_000);
        renderSource(40_000L);
        MediaJobStage summary = new MediaJobStage();
        summary.setOutputRef("{\"segments\":[{\"start_ms\":0,\"end_ms\":2000},{\"start_ms\":10000,\"end_ms\":12000}]}");
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SUMMARIZE))
                .thenReturn(Optional.of(summary));
        ArgumentCaptor<InputStream> subtitle = ArgumentCaptor.forClass(InputStream.class);

        RestClient.Builder workerBuilder = RestClient.builder().baseUrl("http://worker.test");
        MockRestServiceServer worker = MockRestServiceServer.bindTo(workerBuilder).build();
        worker.expect(requestTo("http://worker.test/internal/media/render"))
                .andExpect(jsonPath("$.generative_beats").doesNotExist())
                .andRespond(withSuccess());

        renderPipeline(workerBuilder.build()).execute(message("RENDER"));

        worker.verify();
        verify(storage).putMediaObject(startsWith("subtitles/"), subtitle.capture(), anyLong(), anyString());
        String srt = new String(readAll(subtitle.getValue()), StandardCharsets.UTF_8);
        assertTrue(srt.contains("00:00:02,000 --> 00:00:04,000"), srt);
        assertFalse(srt.contains("00:00:10,000"), srt);
    }

    @Test
    void sttRetriesCatastrophicallyTruncatedTranscriptForScriptSummaryJob() {
        stage(MediaJobStage.StageName.STT);
        job.setRecipeId(MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH);
        MediaAsset asset = new MediaAsset();
        asset.setDurationMs(531_505L);
        when(assetRepository.findById(assetId)).thenReturn(Optional.of(asset));
        MediaJobStage extract = new MediaJobStage();
        extract.setOutputRef("{\"objectRef\":\"transflow-media/extracted/a.wav\"}");
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.EXTRACT_AUDIO))
                .thenReturn(Optional.of(extract));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SOURCE_SEPARATION))
                .thenReturn(Optional.empty());
        when(storage.presignedGetUrl(anyString())).thenReturn("https://storage.example/a.wav");
        when(providerResolver.resolveForCapability(userId, "STT")).thenReturn(
                new ProviderResolverService.ProviderResolution(UUID.randomUUID(), "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen3-omni-flash", true));

        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/stt")).andRespond(withSuccess("""
                {"status":"COMPLETED","segments":[{"text":"Only the first sentence.","start_ms":0,"end_ms":1250}]}
                """, MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://ai.test/media/stt")).andRespond(withSuccess("""
                {"status":"COMPLETED","segments":[{"text":"First.","start_ms":0,"end_ms":1250},
                  {"text":"Last.","start_ms":520000,"end_ms":530000}]}
                """, MediaType.APPLICATION_JSON));

        pipeline(builder.build()).execute(message("STT"));

        server.verify();
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.STT),
                eq(true), argThat(output -> output.path("segments").size() == 2), isNull(),
                isNull(), isNull(), argThat(key -> key.startsWith("internal:")));
    }

    private MediaStageExecutionService pipeline(RestClient aiClient) {
        MediaStageExecutionService pipeline = new MediaStageExecutionService(jobRepository, stageRepository, assetRepository, storage,
                providerResolver, summaryAiClient, summarizationService, callbackService, objectMapper,
                new AppProperties(null, null, null, null, null, null),
                aiClient, RestClient.builder().baseUrl("http://worker.test").build(),
                subtitleSegmentRepository, null, null, null, null);
        pipeline.setTtsSegmentRetryDelayMs(0L);
        return pipeline;
    }

    private void renderSource(long durationMs) {
        MediaAsset asset = new MediaAsset();
        asset.setBucketName("transflow-media");
        asset.setObjectStorageKey("source.mp4");
        asset.setDurationMs(durationMs);
        when(assetRepository.findById(assetId)).thenReturn(Optional.of(asset));
    }

    private void ttsOutput(Long firstMs, Long secondMs) {
        StringBuilder items = new StringBuilder();
        if (firstMs != null) {
            items.append("{\"segment_id\":\"%s\",\"duration_ms\":%d}".formatted(first.getId(), firstMs));
        }
        if (secondMs != null) {
            items.append(items.isEmpty() ? "" : ",")
                    .append("{\"segment_id\":\"%s\",\"duration_ms\":%d}".formatted(second.getId(), secondMs));
        }
        MediaJobStage tts = new MediaJobStage();
        tts.setOutputRef("{\"segments\":[" + items + "]}");
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.TTS))
                .thenReturn(Optional.of(tts));
    }

    private MediaStageExecutionService renderPipeline(RestClient workerClient) {
        return new MediaStageExecutionService(jobRepository, stageRepository, assetRepository, storage,
                providerResolver, summaryAiClient, summarizationService, callbackService, objectMapper,
                new AppProperties(null, null, null, null, null, null),
                RestClient.builder().baseUrl("http://ai.test").build(), workerClient,
                subtitleSegmentRepository, null, null, null, null);
    }

    private byte[] readAll(InputStream in) {
        try {
            return in.readAllBytes();
        } catch (IOException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private MediaJobStage stage(MediaJobStage.StageName name) {
        MediaJobStage stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(name);
        stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
        stage.setWorkerId(correlationId.toString());
        when(stageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        return stage;
    }

    private MediaStageMessage message(String stageName) {
        return new MediaStageMessage(jobId, stageId, stageName, correlationId, (short) 1);
    }

    private SubtitleSegment segment(int seq, String text, long start, long end) {
        SubtitleSegment segment = new SubtitleSegment();
        segment.setId(UUID.randomUUID());
        segment.setMediaJobId(jobId);
        segment.setSeq(seq);
        segment.setTargetText(text);
        segment.setStartMs(start);
        segment.setEndMs(end);
        return segment;
    }

    private byte[] wavBytes(long durationMs) throws Exception {
        AudioFormat format = new AudioFormat(8_000f, 16, 1, true, false);
        int frames = (int) (8_000L * durationMs / 1_000L);
        byte[] pcm = new byte[frames * 2];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        AudioSystem.write(new AudioInputStream(new ByteArrayInputStream(pcm), format, frames),
                AudioFileFormat.Type.WAVE, out);
        return out.toByteArray();
    }
}
