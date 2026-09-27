package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.modules.credit.service.CreditService;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** AUDIO_SEPARATION credit: x-only per source-audio second, never for the CPU pass-through fallback. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MediaStageSourceSeparationBillingTest {

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

    private final UUID jobId = UUID.randomUUID();
    private final UUID stageId = UUID.randomUUID();
    private final UUID assetId = UUID.randomUUID();
    private final UUID correlationId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID workspaceId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setWorkspaceId(workspaceId);
        job.setCreatedByUserId(userId);
        job.setRootAssetId(assetId);
        MediaJobStage stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(MediaJobStage.StageName.SOURCE_SEPARATION);
        stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
        stage.setWorkerId(correlationId.toString());
        stage.setAttemptCount((short) 1);
        MediaJobStage extract = new MediaJobStage();
        extract.setOutputRef("{\"objectRef\":\"transflow-media/extracted.wav\"}");
        MediaAsset asset = new MediaAsset();
        asset.setDurationMs(90_400L);

        when(stageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.EXTRACT_AUDIO))
                .thenReturn(Optional.of(extract));
        when(assetRepository.findById(assetId)).thenReturn(Optional.of(asset));
        when(creditService.canAffordUsage(any(), any(), anyString(), anyLong(), anyBoolean(), any(), any())).thenReturn(true);
        when(creditService.chargeUsage(any(), any(), anyString(), anyLong(), anyBoolean(), any(), any()))
                .thenReturn(BigDecimal.ONE);
    }

    @Test
    void gpuSeparationChargesAudioSecondsWithoutProviderMarkup() {
        pipeline(separationResponse("4.0.1")).execute(message());

        verify(creditService).chargeUsage(eq(workspaceId), eq(userId), eq("AUDIO_SEPARATION"), eq(90L),
                eq(false), any(), any());
    }

    @Test
    void cpuFallbackIsNotCharged() {
        pipeline(separationResponse("cpu-fallback")).execute(message());

        verify(creditService, never()).chargeUsage(any(), any(), eq("AUDIO_SEPARATION"), anyLong(), anyBoolean(),
                any(), any());
    }

    @Test
    void insufficientCreditStopsBeforeCallingTheSeparationEngine() {
        when(creditService.canAffordUsage(any(), any(), eq("AUDIO_SEPARATION"), anyLong(), anyBoolean(), any(), any()))
                .thenReturn(false);
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

        pipeline(builder.build()).execute(message());

        server.verify();
        verify(creditService, never()).chargeUsage(any(), any(), anyString(), anyLong(), anyBoolean(), any(), any());
    }

    private RestClient separationResponse(String engineVersion) {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://ai.test/media/source-separate")).andRespond(withSuccess("""
                {"engine":{"engineId":"local_demucs","engineVersion":"%s","modelId":"htdemucs"},
                 "stems":[{"role":"MUSIC","objectRef":"transflow-media/music.wav"}]}
                """.formatted(engineVersion), MediaType.APPLICATION_JSON));
        return builder.build();
    }

    private MediaStageExecutionService pipeline(RestClient aiClient) {
        return new MediaStageExecutionService(jobRepository, stageRepository, assetRepository, storage,
                providerResolver, summaryAiClient, summarizationService, callbackService, new ObjectMapper(),
                new AppProperties(null, null, null, null, null, null),
                aiClient, RestClient.builder().baseUrl("http://worker.test").build(),
                subtitleSegmentRepository, null, creditService, null, null);
    }

    private MediaStageMessage message() {
        return new MediaStageMessage(jobId, stageId, "SOURCE_SEPARATION", correlationId, (short) 1);
    }
}
