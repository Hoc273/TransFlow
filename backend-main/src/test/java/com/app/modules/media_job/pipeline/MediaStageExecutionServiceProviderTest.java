package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.summarization.service.SummarizationService;
import com.app.modules.summarization.service.SummaryAiClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.http.HttpMethod.POST;

@ExtendWith(MockitoExtension.class)
class MediaStageExecutionServiceProviderTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private MediaAssetRepository assetRepository;
    @Mock private MediaStorageService storage;
    @Mock private ProviderResolverService providerResolver;
    @Mock private SummaryAiClient summaryAiClient;
    @Mock private SummarizationService summarizationService;
    @Mock private MediaCallbackService callbackService;

    private ObjectMapper objectMapper;
    private MediaStageExecutionService service;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new MediaStageExecutionService(jobRepository, stageRepository, assetRepository, storage,
                providerResolver, summaryAiClient, summarizationService, callbackService, objectMapper,
                new AppProperties(null, null, null, null, null, null));
    }

    @Test
    void providerPayloadUsesModelFromResolvedCapability() {
        UUID userId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        MediaJob job = new MediaJob();
        job.setCreatedByUserId(userId);
        when(providerResolver.resolveForCapability(userId, "TRANSLATE")).thenReturn(
                new ProviderResolverService.ProviderResolution(providerId, "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen-plus", true));

        MediaStageExecutionService.ProviderContext context = service.provider(job, "TRANSLATE");

        assertEquals("qwen-plus", context.payload().get("model"));
        assertEquals("dashscope_native", context.payload().get("protocol"));
        assertEquals(List.of("TEXT"), context.payload().get("capabilities"));
        assertTrue(context.personalApiKey());
    }

    @Test
    void resolverConfigurationFailureIsPersistedAsTypedStageFailureWithoutFallback() {
        UUID jobId = UUID.randomUUID();
        UUID stageId = UUID.randomUUID();
        UUID correlationId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID assetId = UUID.randomUUID();
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setRootAssetId(assetId);
        job.setCreatedByUserId(userId);
        MediaJobStage stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(MediaJobStage.StageName.STT);
        stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
        stage.setWorkerId(correlationId.toString());
        MediaJobStage extract = new MediaJobStage();
        extract.setOutputRef("audio/test.wav");
        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(stageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.EXTRACT_AUDIO))
                .thenReturn(Optional.of(extract));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SOURCE_SEPARATION))
                .thenReturn(Optional.empty());
        when(assetRepository.findById(assetId)).thenReturn(Optional.empty());
        when(storage.presignedGetUrl("audio/test.wav")).thenReturn("https://storage.example/audio");
        when(providerResolver.resolveForCapability(userId, "STT"))
                .thenThrow(new AppException(ErrorCode.PROVIDER_DEFAULT_NOT_CONFIGURED));

        service.execute(new MediaStageMessage(jobId, stageId, "STT", correlationId, (short) 1));

        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.STT),
                eq(false), isNull(), eq(ErrorCode.PROVIDER_DEFAULT_NOT_CONFIGURED.getMessage()),
                eq("PROVIDER_DEFAULT_NOT_CONFIGURED"), argThat(detail ->
                        detail != null && detail.path("errorCode").asText().equals("PROVIDER_DEFAULT_NOT_CONFIGURED")),
                argThat(key -> key.startsWith("internal:")));
        verify(providerResolver, times(1)).resolveForCapability(userId, "STT");
    }

    @Test
    void failedTranslateResponseIsForwardedAsTypedQuotaFailureWithResolvedModel() {
        UUID jobId = UUID.randomUUID();
        UUID stageId = UUID.randomUUID();
        UUID correlationId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        MediaJob job = new MediaJob();
        job.setId(jobId);
        job.setCreatedByUserId(userId);
        job.setRecipeId("localization.full");
        job.setTargetLang("vi");

        MediaJobStage stage = new MediaJobStage();
        stage.setId(stageId);
        stage.setMediaJobId(jobId);
        stage.setStageName(MediaJobStage.StageName.TRANSLATE);
        stage.setStatus(MediaJobStage.StageStatus.PROCESSING);
        stage.setWorkerId(correlationId.toString());

        MediaJobStage summary = new MediaJobStage();
        summary.setOutputRef("{\"script_content\":\"Hello world\"}");
        MediaJobStage stt = new MediaJobStage();
        stt.setOutputRef("{\"segments\":[{\"start_ms\":0,\"end_ms\":1000,\"text\":\"Hello world\"}]}");

        when(jobRepository.findById(jobId)).thenReturn(Optional.of(job));
        when(stageRepository.findById(stageId)).thenReturn(Optional.of(stage));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.SUMMARIZE))
                .thenReturn(Optional.of(summary));
        when(stageRepository.findByMediaJobIdAndStageName(jobId, MediaJobStage.StageName.STT))
                .thenReturn(Optional.of(stt));
        when(providerResolver.resolveForCapability(userId, "TRANSLATE")).thenReturn(
                new ProviderResolverService.ProviderResolution(UUID.randomUUID(), "dashscope_native",
                        "https://dashscope.example/api", "secret", "qwen-plus", true));

        RestClient.Builder aiBuilder = RestClient.builder().baseUrl("http://ai.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(aiBuilder).build();
        RestClient aiClient = aiBuilder.build();
        server.expect(requestTo("http://ai.test/ai/translate"))
                .andExpect(method(POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath("$.provider.model")
                        .value("qwen-plus"))
                .andRespond(withSuccess("""
                        {"status":"FAILED","error":"Provider quota has been exhausted","error_detail":{
                          "errorCode":"PROVIDER_QUOTA_EXCEEDED","title":"Quota Exceeded",
                          "message":"Provider quota has been exhausted","retryable":false,
                          "recommendedAction":"Check provider billing and quota.",
                          "protocol":"dashscope_native","capability":"TEXT","model":"qwen-plus"}}
                        """, MediaType.APPLICATION_JSON));

        MediaStageExecutionService pipeline = new MediaStageExecutionService(jobRepository, stageRepository,
                assetRepository, storage, providerResolver, summaryAiClient, summarizationService,
                callbackService, objectMapper, new AppProperties(null, null, null, null, null, null),
                aiClient, RestClient.builder().baseUrl("http://worker.test").build(),
                null, null, null, null, null);

        pipeline.execute(new MediaStageMessage(jobId, stageId, "TRANSLATE", correlationId, (short) 1));

        server.verify();
        verify(callbackService).completeStage(eq(jobId), eq(stageId), eq(MediaJobStage.StageName.TRANSLATE),
                eq(false), isNull(), eq("Provider quota has been exhausted"), eq("PROVIDER_QUOTA_EXCEEDED"),
                argThat(detail -> detail != null
                        && detail.path("errorCode").asText().equals("PROVIDER_QUOTA_EXCEEDED")
                        && detail.path("model").asText().equals("qwen-plus")
                        && !detail.path("retryable").asBoolean(true)),
                argThat(key -> key.startsWith("internal:")));
    }
}
