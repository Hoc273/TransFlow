package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.common.exception.AiStageException;
import com.app.common.exception.AppException;
import com.app.modules.credit.service.CreditService;
import com.app.modules.credit.service.AiUsageLogService;
import com.app.modules.glossary.entity.GlossaryTerm;
import com.app.modules.glossary.service.GlossaryService;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.pipeline.dto.ExtractAudioRequest;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.qa.entity.QaIssue;
import com.app.modules.qa.service.QaService;
import com.app.modules.summarization.service.SummaryAiClient;
import com.app.modules.summarization.service.SummarizationService;
import com.app.modules.summarization.entity.SummaryProposal;
import com.app.modules.summarization.entity.SummaryProposalSegment;
import com.app.modules.summarization.service.UserAwareSummaryAiClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.io.ByteArrayInputStream;
import java.net.SocketTimeoutException;
import java.net.http.HttpTimeoutException;
import java.util.Base64;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Executes a claimed stage and keeps all durable state changes in Spring. */
@Service
@ConditionalOnProperty(name = "app.pipeline.enabled", havingValue = "true", matchIfMissing = true)
public class MediaStageExecutionService {

    private static final Logger log = LoggerFactory.getLogger(MediaStageExecutionService.class);

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final MediaAssetRepository assetRepository;
    private final MediaStorageService storage;
    private final ProviderResolverService providerResolver;
    private final SummaryAiClient summaryAiClient;
    private final SummarizationService summarizationService;
    private final MediaCallbackService callbackService;
    private final ObjectMapper objectMapper;
    private final RestClient aiClient;
    private final RestClient mediaAiClient;
    private final RestClient sourceSeparationAiClient;
    private final RestClient workerClient;
    private final AppProperties props;
    private final SubtitleSegmentRepository subtitleSegmentRepository;
    private final QaService qaService;
    private final CreditService creditService;
    private final AiUsageLogService aiUsageLogService;
    private final GlossaryService glossaryService;

    @Autowired
    public MediaStageExecutionService(MediaJobRepository jobRepository,
                                      MediaJobStageRepository stageRepository,
                                      MediaAssetRepository assetRepository,
                                      MediaStorageService storage,
                                      ProviderResolverService providerResolver,
                                      SummaryAiClient summaryAiClient,
                                      SummarizationService summarizationService,
                                      MediaCallbackService callbackService,
                                      ObjectMapper objectMapper,
                                      AppProperties props,
                                      @Qualifier("mediaAiRestClient") RestClient mediaAiClient,
                                      @Qualifier("sourceSeparationAiRestClient") RestClient sourceSeparationAiClient,
                                      @Qualifier("aiRestClient") RestClient aiClient,
                                      @Qualifier("mediaWorkerRestClient") RestClient workerClient,
                                      SubtitleSegmentRepository subtitleSegmentRepository,
                                      QaService qaService,
                                      CreditService creditService,
                                      AiUsageLogService aiUsageLogService,
                                      GlossaryService glossaryService) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.assetRepository = assetRepository;
        this.storage = storage;
        this.providerResolver = providerResolver;
        this.summaryAiClient = summaryAiClient;
        this.summarizationService = summarizationService;
        this.callbackService = callbackService;
        this.objectMapper = objectMapper;
        this.props = props;
        this.aiClient = aiClient;
        this.mediaAiClient = mediaAiClient;
        this.sourceSeparationAiClient = sourceSeparationAiClient;
        this.workerClient = workerClient;
        this.subtitleSegmentRepository = subtitleSegmentRepository;
        this.qaService = qaService;
        this.creditService = creditService;
        this.aiUsageLogService = aiUsageLogService;
        this.glossaryService = glossaryService;
    }

    /** Compatibility constructor for tests and callers that provide a single AI client. */
    public MediaStageExecutionService(MediaJobRepository jobRepository,
                                      MediaJobStageRepository stageRepository,
                                      MediaAssetRepository assetRepository,
                                      MediaStorageService storage,
                                      ProviderResolverService providerResolver,
                                      SummaryAiClient summaryAiClient,
                                      SummarizationService summarizationService,
                                      MediaCallbackService callbackService,
                                      ObjectMapper objectMapper,
                                      AppProperties props,
                                      RestClient aiClient,
                                      RestClient workerClient,
                                      SubtitleSegmentRepository subtitleSegmentRepository,
                                      QaService qaService,
                                      CreditService creditService,
                                      AiUsageLogService aiUsageLogService,
                                      GlossaryService glossaryService) {
        this(jobRepository, stageRepository, assetRepository, storage, providerResolver, summaryAiClient,
                summarizationService, callbackService, objectMapper, props, aiClient, aiClient, aiClient, workerClient,
                subtitleSegmentRepository, qaService, creditService, aiUsageLogService, glossaryService);
    }

    /** Compatibility constructor for focused pipeline tests that do not wire QA/credit/glossary. */
    public MediaStageExecutionService(MediaJobRepository jobRepository,
                                      MediaJobStageRepository stageRepository,
                                      MediaAssetRepository assetRepository,
                                      MediaStorageService storage,
                                      ProviderResolverService providerResolver,
                                      SummaryAiClient summaryAiClient,
                                      SummarizationService summarizationService,
                                      MediaCallbackService callbackService,
                                      ObjectMapper objectMapper,
                                      AppProperties props) {
        this(jobRepository, stageRepository, assetRepository, storage, providerResolver,
                summaryAiClient, summarizationService, callbackService, objectMapper, props,
                RestClient.builder().baseUrl(props.ai().baseUrl()).build(),
                RestClient.builder().baseUrl(props.ai().baseUrl()).build(),
                RestClient.builder().baseUrl(props.ai().baseUrl()).build(),
                RestClient.builder().baseUrl(props.mediaWorker().baseUrl()).build(),
                null, null, null, null, null);
    }

    public void execute(MediaStageMessage message) {
        MediaJob job = jobRepository.findById(message.jobId()).orElse(null);
        MediaJobStage stage = stageRepository.findById(message.stageId()).orElse(null);
        if (job == null || stage == null || !message.jobId().equals(stage.getMediaJobId())
                || stage.getStatus() != MediaJobStage.StageStatus.PROCESSING
                || !message.correlationId().toString().equals(stage.getWorkerId())) {
            return; // stale/duplicate delivery; the DB claim is authoritative.
        }
        try {
            switch (stage.getStageName()) {
                case EXTRACT_AUDIO, AUDIO_MIX, RENDER -> dispatchWorker(job, stage, message);
                case SOURCE_SEPARATION -> executeSourceSeparation(job, stage, message);
                case STT -> executeStt(job, stage, message);
                case SUMMARIZE -> executeSummarize(job, stage, message);
                case TRANSLATE -> executeTranslate(job, stage, message);
                case TTS -> executeTts(job, stage, message);
            }
        } catch (Exception ex) {
            String service = downstreamService(stage.getStageName());
            AiStageException failure = stageFailure(stage, ex);
            Integer downstreamStatus = ex instanceof RestClientResponseException response
                    ? response.getStatusCode().value() : null;
            if (ex instanceof RestClientResponseException response) {
                log.error("Media stage failed job={} stage={} service={} errorCode={} protocol={} capability={} model={} retryable={} downstreamStatus={} errorType={}",
                        message.jobId(), stage.getStageName(), service,
                        failure.getErrorCode(), failure.getProtocol(), failure.getCapability(), failure.getModel(),
                        failure.isRetryable(), downstreamStatus, ex.getClass().getSimpleName(), sanitizedStack(ex));
            } else if (ex instanceof ResourceAccessException) {
                log.error("Media stage failed job={} stage={} service={} errorCode={} protocol={} capability={} model={} retryable={} downstreamStatus={} errorType={}",
                        message.jobId(), stage.getStageName(), service,
                        failure.getErrorCode(), failure.getProtocol(), failure.getCapability(), failure.getModel(),
                        failure.isRetryable(), downstreamStatus, ex.getClass().getSimpleName(), sanitizedStack(ex));
            } else {
                log.error("Media stage failed job={} stage={} errorCode={} protocol={} capability={} model={} retryable={} downstreamStatus={} errorType={}",
                        message.jobId(), stage.getStageName(), failure.getErrorCode(), failure.getProtocol(),
                        failure.getCapability(), failure.getModel(), failure.isRetryable(), downstreamStatus,
                        ex.getClass().getSimpleName(), sanitizedStack(ex));
            }
            completeFailure(job, stage, message, failure);
        }
    }

    private void dispatchWorker(MediaJob job, MediaJobStage stage, MediaStageMessage message) {
        MediaAsset asset = assetRepository.findById(job.getRootAssetId()).orElseThrow();
        String sourceRef = asset.getBucketName() + "/" + asset.getObjectStorageKey();
        Map<String, Object> body = jsonObject(stage.getInputRef());
        body.put("correlation_id", message.correlationId().toString());
        body.put("media_job_id", job.getId().toString());
        body.put("stage_id", stage.getId().toString());

        String path;
        switch (stage.getStageName()) {
            case EXTRACT_AUDIO -> {
                path = "/internal/media/extract-audio";
                body.put("source_video_ref", sourceRef);
            }
            case AUDIO_MIX -> {
                path = "/internal/media/audio-mix";
                Object plan = body.get("mix_plan");
                if (!(plan instanceof Map<?, ?>)) {
                    body.put("mix_plan", defaultMixPlan(job));
                }
                body.put("mix_plan", applyConfiguredAudioMix(job, body.get("mix_plan")));
            }
            case RENDER -> {
                path = "/internal/media/render";
                body.putIfAbsent("source_video_ref", sourceRef);
                body.putIfAbsent("callback_base_url", props.mediaWorker().callbackBaseUrl());
                long duration = asset.getDurationMs() == null ? 60_000L : asset.getDurationMs();
                body.putIfAbsent("cut_ranges", defaultCutRanges(job, duration));
                body.putIfAbsent("audio_input_version", "1");
                addDefaultRenderAudio(job, body, duration);
                body.put("subtitle_track", defaultSubtitleTrack(job, duration));
                Map<String, Object> renderConfig = jsonObject(job.getRenderConfig());
                body.put("output_aspect_ratio", stringValue(renderConfig.get("outputAspectRatio"), "ORIGINAL"));
            }
            default -> throw new IllegalStateException("Not a worker stage");
        }
        Object requestBody = body;
        if (stage.getStageName() == MediaJobStage.StageName.EXTRACT_AUDIO) {
            requestBody = new ExtractAudioRequest(
                    message.correlationId().toString(),
                    job.getId().toString(),
                    stage.getId().toString(),
                    sourceRef);
        }
        workerClient.post().uri(path).contentType(MediaType.APPLICATION_JSON).body(requestBody)
                .retrieve().toBodilessEntity();
    }

    private String downstreamService(MediaJobStage.StageName stage) {
        return switch (stage) {
            case EXTRACT_AUDIO, AUDIO_MIX, RENDER -> "Media worker";
            default -> "AI gateway";
        };
    }

    private AiStageException stageFailure(MediaJobStage stage, Exception ex) {
        String capability = switch (stage.getStageName()) {
            case STT -> "STT";
            case TTS -> "TTS";
            case TRANSLATE, SUMMARIZE -> "TEXT";
            default -> null;
        };
        if (ex instanceof AiStageException typed) return typed;
        if (ex instanceof RestClientResponseException response) {
            return AiStageException.fromRestClientResponse(response, objectMapper, capability, null);
        }
        if (ex instanceof AppException appException) {
            return AiStageException.fromAppException(appException, capability);
        }
        if (ex instanceof ResourceAccessException) {
            String code = isTimeoutFailure(ex) ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
            String message = isTimeoutFailure(ex) ? "AI provider request timed out"
                    : "AI provider is unavailable";
            return AiStageException.safeFailure(code, message,
                    true, "Try again later or check the provider service.", capability, null);
        }
        return AiStageException.safeFailure("MEDIA_STAGE_EXECUTION_FAILED", "Media stage execution failed",
                false, null, capability, null);
    }

    private boolean isTimeoutFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof SocketTimeoutException || cause instanceof HttpTimeoutException) {
                return true;
            }
        }
        return false;
    }

    /** Downstream messages may echo request data, so log the stack without the original message. */
    private Throwable sanitizedStack(Exception ex) {
        RuntimeException safe = new RuntimeException(ex.getClass().getSimpleName());
        safe.setStackTrace(ex.getStackTrace());
        return safe;
    }

    private Map<String, Object> defaultMixPlan(MediaJob job) {
        String musicRef = objectRef(findStage(job.getId(), MediaJobStage.StageName.SOURCE_SEPARATION) == null
                ? null : findStage(job.getId(), MediaJobStage.StageName.SOURCE_SEPARATION).getOutputRef());
        JsonNode separation = parseJson(findStage(job.getId(), MediaJobStage.StageName.SOURCE_SEPARATION) == null
                ? null : findStage(job.getId(), MediaJobStage.StageName.SOURCE_SEPARATION).getOutputRef());
        if (separation != null && separation.path("stems").isArray()) {
            for (JsonNode stem : separation.path("stems")) {
                if ("MUSIC".equalsIgnoreCase(stem.path("role").asText())) {
                    musicRef = stem.path("objectRef").asText(musicRef);
                    break;
                }
            }
        }
        String ttsRef = objectRef(findStage(job.getId(), MediaJobStage.StageName.TTS) == null
                ? null : findStage(job.getId(), MediaJobStage.StageName.TTS).getOutputRef());
        if (musicRef == null || ttsRef == null) {
            throw new IllegalArgumentException("AUDIO_MIX requires MUSIC and TTS outputs");
        }
        long duration = assetRepository.findById(job.getRootAssetId()).map(MediaAsset::getDurationMs)
                .orElse(60_000L);
        Map<String, Object> bed = new LinkedHashMap<>();
        bed.put("input_id", "music");
        bed.put("role", "STEM_MUSIC");
        bed.put("audio_ref", musicRef);
        Map<String, Object> voice = new LinkedHashMap<>();
        voice.put("input_id", "tts-1");
        voice.put("role", "TTS_SEGMENT");
        voice.put("audio_ref", ttsRef);
        voice.put("segment_id", "tts-1");
        voice.put("start_ms", 0);
        voice.put("end_ms", duration);
        return new LinkedHashMap<>(Map.of(
                "plan_version", 1,
                "inputs", List.of(bed, voice),
                "ducking", Map.of("kind", "WHOLE_MIX", "speech_input_ids", List.of("tts-1"),
                        "target_input_id", "music", "duck_gain_db", -12),
                "output", Map.of("asset_type", "MIXED_AUDIO", "format", "wav")));
    }

    /** Apply the persisted Render Studio audio controls to the worker MixPlan. */
    private Map<String, Object> applyConfiguredAudioMix(MediaJob job, Object rawPlan) {
        Map<String, Object> plan = copyMap(rawPlan);
        List<Map<String, Object>> inputs = new ArrayList<>();
        Object rawInputs = plan.get("inputs");
        if (rawInputs instanceof List<?> list) {
            for (Object rawInput : list) {
                inputs.add(copyMap(rawInput));
            }
        }
        plan.put("inputs", inputs);

        Map<String, Object> config = jsonObject(job.getRenderConfig());
        Map<String, Object> presentation = mapValue(config.get("presentation"));
        Map<String, Object> audio = mapValue(presentation.get("audio"));
        Double originalGain = doubleOrNull(audio.get("originalGainDb"));
        Double ttsGain = doubleOrNull(audio.get("ttsGainDb"));
        for (Map<String, Object> input : inputs) {
            String role = stringValue(input.get("role"), "");
            if (originalGain != null && !"TTS_SEGMENT".equals(role)) {
                input.put("gain_db", originalGain);
            }
            if (ttsGain != null && "TTS_SEGMENT".equals(role)) {
                input.put("gain_db", ttsGain);
            }
        }

        Map<String, Object> configuredDucking = mapValue(audio.get("ducking"));
        if (!configuredDucking.isEmpty()) {
            Map<String, Object> ducking = copyMap(plan.get("ducking"));
            boolean enabled = booleanValue(configuredDucking.get("enabled"), true);
            ducking.put("kind", enabled ? "WHOLE_MIX" : "NONE");
            if (enabled) {
                putIfNotNull(ducking, "duck_gain_db", doubleOrNull(configuredDucking.get("gainDb")));
                putIfNotNull(ducking, "attack_ms", integerOrNull(configuredDucking.get("attackMs")));
                putIfNotNull(ducking, "release_ms", integerOrNull(configuredDucking.get("releaseMs")));
            }
            plan.put("ducking", ducking);
        }
        return plan;
    }

    /**
     * Keep the render stage grounded in the proposal selected by the user.
     * Script-first proposals expose matched ranges directly in the SUMMARIZE
     * output; derived-language jobs reuse the source proposal rows.  A full
     * source-video range remains the safe fallback for legacy/localization
     * jobs that have no persisted cut plan yet.
     */
    private List<Map<String, Object>> defaultCutRanges(MediaJob job, long sourceDurationMs) {
        List<Map<String, Object>> ranges = new ArrayList<>();
        try {
            if (job.getSelectedProposalId() != null) {
                for (SummaryProposalSegment segment : summarizationService.getSegments(job.getSelectedProposalId())) {
                    if (segment.getEndMs() > segment.getStartMs()) {
                        ranges.add(Map.of("start_ms", segment.getStartMs(), "end_ms", segment.getEndMs()));
                    }
                }
            }
            if (ranges.isEmpty()) {
                MediaJobStage summaryStage = findStage(job.getId(), MediaJobStage.StageName.SUMMARIZE);
                JsonNode summary = parseJson(summaryStage == null ? null : summaryStage.getOutputRef());
                JsonNode scriptSegments = summary == null ? null : summary.get("segments");
                if (scriptSegments != null && scriptSegments.isArray()) {
                    for (JsonNode segment : scriptSegments) {
                        long start = segment.path("start_ms").asLong(segment.path("startMs").asLong(-1));
                        long end = segment.path("end_ms").asLong(segment.path("endMs").asLong(-1));
                        if (start >= 0 && end > start) {
                            ranges.add(Map.of("start_ms", start, "end_ms", end));
                        }
                    }
                }
                if (ranges.isEmpty() && summary != null && summary.path("proposals").isArray()
                        && !summary.path("proposals").isEmpty()) {
                    JsonNode cutRanges = summary.path("proposals").get(0).path("cut_ranges");
                    if (!cutRanges.isArray()) {
                        cutRanges = summary.path("proposals").get(0).path("cutRanges");
                    }
                    if (cutRanges.isArray()) {
                        for (JsonNode range : cutRanges) {
                            long start = range.path("start_ms").asLong(range.path("startMs").asLong(-1));
                            long end = range.path("end_ms").asLong(range.path("endMs").asLong(-1));
                            if (start >= 0 && end > start) {
                                ranges.add(Map.of("start_ms", start, "end_ms", end));
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // Rendering must still be able to use the full source range if an
            // optional proposal row was removed or is not available yet.
        }
        return ranges.isEmpty()
                ? List.of(Map.of("start_ms", 0L, "end_ms", Math.max(1L, sourceDurationMs)))
                : ranges;
    }

    private void addDefaultRenderAudio(MediaJob job, Map<String, Object> body, long duration) {
        if (job.getOutputAudioMode() == MediaJob.OutputAudioMode.DUB_MIX) {
            String mixed = objectRef(output(job.getId(), MediaJobStage.StageName.AUDIO_MIX));
            if (mixed != null) {
                body.putIfAbsent("audio_source", "MIXED_AUDIO");
                body.putIfAbsent("resolved_audio_ref", mixed);
                return;
            }
        }
        String tts = objectRef(output(job.getId(), MediaJobStage.StageName.TTS));
        if (job.getOutputAudioMode() == MediaJob.OutputAudioMode.DUB_REPLACE && tts != null) {
            body.putIfAbsent("audio_source", "LEGACY_DUBBED");
            body.putIfAbsent("audio_mode", "DUBBED");
            body.putIfAbsent("segment_audios", List.of(Map.of(
                    "segment_id", "tts-1", "audio_ref", tts, "start_ms", 0, "end_ms", duration)));
            return;
        }
        body.putIfAbsent("audio_source", "LEGACY_ORIGINAL");
        body.putIfAbsent("audio_mode", "ORIGINAL");
    }

    private Map<String, Object> defaultSubtitleTrack(MediaJob job, long duration) {
        Map<String, Object> renderConfig = jsonObject(job.getRenderConfig());
        Map<String, Object> style = jsonObject(job.getSubtitleStyle());
        List<SubtitleSegment> segments = subtitleSegmentRepository == null
                ? List.of() : subtitleSegmentRepository.findByMediaJobIdOrderBySeq(job.getId());

        // Pre-render check: repair blank/out-of-range/overlapping cues, then group them per displayMode.
        List<RenderSubtitleCues.Cue> raw = new ArrayList<>();
        for (SubtitleSegment segment : segments) {
            raw.add(new RenderSubtitleCues.Cue(segment.getStartMs(), segment.getEndMs(), segment.getTargetText()));
        }
        List<RenderSubtitleCues.Cue> cues = RenderSubtitleCues.sanitize(raw, duration);
        if (cues.isEmpty()) {
            // Never burn a placeholder (the whole translation as one cue over the video).
            throw AiStageException.safeFailure("SUBTITLE_CUES_MISSING", "No valid subtitle cues to render",
                    false, "Run TRANSLATE again or fix the subtitles in the editor before rendering.", null, null);
        }
        if (cues.size() != raw.size()) {
            log.info("Pre-render subtitle check job={} segments={} renderable={}", job.getId(), raw.size(), cues.size());
        }
        Map<String, Object> subtitlePresentation = mapValue(mapValue(renderConfig.get("presentation")).get("subtitle"));
        cues = RenderSubtitleCues.group(cues, stringValue(subtitlePresentation.get("displayMode"), null),
                integerOrNull(subtitlePresentation.get("wordsPerPhrase")));

        StringBuilder srt = new StringBuilder();
        int seq = 1;
        for (RenderSubtitleCues.Cue cue : cues) {
            srt.append(seq++).append('\n')
                    .append(srtTimestamp(cue.startMs())).append(" --> ").append(srtTimestamp(cue.endMs())).append('\n')
                    .append(cue.text())
                    .append("\n\n");
        }
        String key = "subtitles/" + job.getId() + "/" + UUID.randomUUID() + ".srt";
        String content = srt.toString();
        byte[] subtitle = content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        storage.putMediaObject(key, new ByteArrayInputStream(subtitle), subtitle.length, "application/x-subrip");
        Map<String, Object> track = new LinkedHashMap<>();
        track.put("format", "srt");
        track.put("content_ref", storage.mediaBucket() + "/" + key);
        String subtitleMode = stringValue(renderConfig.get("subtitleMode"),
                job.getSubtitleMode() == null ? "SOFT_SUB" : job.getSubtitleMode().name());
        track.put("mode", subtitleMode);
        track.put("position", stringValue(renderConfig.get("subtitlePosition"), "BOTTOM"));
        track.put("vertical_offset_percent", intValue(renderConfig.get("verticalOffsetPercent"), 0));
        boolean styleHasBackground = style.get("background") != null && !String.valueOf(style.get("background")).isBlank();
        track.put("background_box", booleanValue(renderConfig.get("backgroundBox"), styleHasBackground));
        putIfNotNull(track, "background_color", firstNonBlank(
                stringValue(renderConfig.get("backgroundColor"), null),
                stringValue(style.get("background"), null)));
        putIfNotNull(track, "text_color", firstNonBlank(
                stringValue(renderConfig.get("textColor"), null),
                stringValue(style.get("primary_color"), null)));
        putIfNotNull(track, "font_size", integerOrNull(style.get("font_size")));
        putIfNotNull(track, "bold", booleanOrNull(style.get("bold")));
        putIfNotNull(track, "outline_width", integerOrNull(style.get("outline_width")));
        putIfNotNull(track, "outline_color", stringValue(style.get("outline_color"), null));
        // Worker presentation layers are burn-time overlays and are rejected
        // for SOFT_SUB by contract; keep them only for HARD_SUB renders.
        if ("HARD_SUB".equalsIgnoreCase(subtitleMode)) {
            track.put("layers", renderPresentationLayers(renderConfig));
        }
        return track;
    }

    private List<Map<String, Object>> renderPresentationLayers(Map<String, Object> renderConfig) {
        Map<String, Object> presentation = mapValue(renderConfig.get("presentation"));
        Map<String, Object> subtitle = mapValue(presentation.get("subtitle"));
        Object rawLayers = subtitle.get("layers");
        if (!(rawLayers instanceof List<?> list)) {
            return List.of();
        }
        List<Map<String, Object>> layers = new ArrayList<>();
        int index = 0;
        for (Object rawLayer : list) {
            Map<String, Object> layer = mapValue(rawLayer);
            Map<String, Object> mapped = new LinkedHashMap<>();
            mapped.put("id", "layer-" + index);
            // The current worker contract has SOLID/BLUR overlays. COVER_BOX is
            // the Spring MVP layer; unsupported legacy layer kinds degrade to a
            // solid cover instead of sending a 422 payload to the worker.
            mapped.put("type", "SOLID");
            mapped.put("enabled", true);
            mapped.put("z_index", index++);
            mapped.put("anchor", stringValue(layer.get("anchor"), "SUBTITLE"));
            Map<String, Object> geometry = new LinkedHashMap<>();
            geometry.put("width_percent", intValue(layer.get("widthPercent"), 100));
            geometry.put("height_percent", intValue(layer.get("heightPercent"), 12));
            putIfNotNull(geometry, "x_percent", integerOrNull(layer.get("xPercent")));
            putIfNotNull(geometry, "y_percent", integerOrNull(layer.get("yPercent")));
            mapped.put("geometry", geometry);
            Map<String, Object> style = new LinkedHashMap<>();
            style.put("color", stringValue(layer.get("colorHex"), "#000000"));
            double opacity = doubleValue(layer.get("opacity"), 1.0d);
            style.put("opacity_percent", Math.max(0, Math.min(100, (int) Math.round(opacity * 100.0d))));
            mapped.put("style", style);
            layers.add(mapped);
        }
        return layers;
    }

    private String output(UUID jobId, MediaJobStage.StageName name) {
        MediaJobStage stage = findStage(jobId, name);
        return stage == null ? null : stage.getOutputRef();
    }

    private void executeSourceSeparation(MediaJob job, MediaJobStage stage, MediaStageMessage message) {
        MediaJobStage extract = findStage(job.getId(), MediaJobStage.StageName.EXTRACT_AUDIO);
        String audioRef = objectRef(extract == null ? null : extract.getOutputRef());
        if (audioRef == null) {
            throw new IllegalArgumentException("SOURCE_SEPARATION requires EXTRACT_AUDIO output");
        }
        Map<String, Object> body = Map.of(
                "runId", message.correlationId().toString(),
                "sourceAudioRef", audioRef,
                "profile", "VOCAL_MUSIC");
        JsonNode result = sourceSeparationAiClient.post().uri("/media/source-separate")
                .contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(JsonNode.class);
        completeSuccess(job, stage, message, result);
    }

    private void executeStt(MediaJob job, MediaJobStage stage, MediaStageMessage message) {
        MediaJobStage extract = findStage(job.getId(), MediaJobStage.StageName.EXTRACT_AUDIO);
        MediaJobStage separation = findStage(job.getId(), MediaJobStage.StageName.SOURCE_SEPARATION);
        String audioRef = separation != null && separation.getStatus() == MediaJobStage.StageStatus.COMPLETED
                ? objectRef(separation.getOutputRef()) : objectRef(extract == null ? null : extract.getOutputRef());
        if (audioRef == null) {
            throw new IllegalArgumentException("STT requires extracted audio output");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("correlation_id", message.correlationId().toString());
        body.put("media_job_id", job.getId().toString());
        body.put("audio_ref", audioRef);
        body.put("audio_url", storage.presignedGetUrl(audioRef));
        body.put("source_lang", job.getSourceLanguage());
        Long durationMs = assetRepository.findById(job.getRootAssetId()).map(MediaAsset::getDurationMs).orElse(null);
        if (durationMs != null) {
            body.put("asset_duration_ms", durationMs);
        }
        ProviderContext provider = provider(job, "STT");
        body.put("provider", provider.payload());
        JsonNode result = executeSttWithRetry(stage, body, provider);
        ensureCompleted(result, "STT");
        chargeAiUsage(job, "STT", usageUnits(result, "STT", durationMs == null ? 0L : durationMs),
                provider.personalApiKey());
        completeSuccess(job, stage, message, result);
    }

    private JsonNode executeSttWithRetry(MediaJobStage stage, Map<String, Object> body,
                                         ProviderContext provider) {
        int retries = props.ai().maxRetries();
        int attempt = 0;
        while (true) {
            try {
                return mediaAiClient.post().uri("/media/stt").contentType(MediaType.APPLICATION_JSON)
                        .body(body).retrieve().body(JsonNode.class);
            } catch (RuntimeException ex) {
                AiStageException failure = stageFailure(stage, ex, provider);
                if (!failure.isRetryable() || attempt >= retries) {
                    throw failure;
                }
                long delayMs = 250L << Math.min(attempt, 10);
                log.warn("Retrying STT after retryable failure errorCode={} attempt={}/{}",
                        failure.getErrorCode(), attempt + 1, retries);
                attempt++;
                try {
                    Thread.sleep(delayMs);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while retrying STT", interrupted);
                }
            }
        }
    }

    private AiStageException stageFailure(MediaJobStage stage, RuntimeException ex,
                                          ProviderContext provider) {
        AiStageException failure = stageFailure(stage, ex);
        if (!(ex instanceof ResourceAccessException) || failure.getProtocol() != null) {
            return failure;
        }
        String protocol = String.valueOf(provider.payload().getOrDefault("protocol", ""));
        String model = String.valueOf(provider.payload().getOrDefault("model", ""));
        Map<String, Object> detail = new LinkedHashMap<>(failure.getErrorDetail());
        if (!protocol.isBlank()) detail.put("protocol", protocol);
        if (!model.isBlank()) detail.put("model", model);
        return new AiStageException(failure.getErrorCode(), failure.getMessage(), failure.isRetryable(),
                failure.getRecommendedAction(), protocol.isBlank() ? null : protocol, "STT",
                model.isBlank() ? null : model, detail);
    }

    private void executeSummarize(MediaJob job, MediaJobStage stage, MediaStageMessage message) throws Exception {
        MediaJobStage stt = findStage(job.getId(), MediaJobStage.StageName.STT);
        JsonNode transcript = parseJson(stt == null ? null : stt.getOutputRef());
        List<Map<String, Object>> segments = transcriptSegments(transcript);
        int duration = job.getRequestedDurationSeconds() != null ? job.getRequestedDurationSeconds()
                : assetRepository.findById(job.getRootAssetId()).map(MediaAsset::getDurationMs)
                .map(ms -> Math.max(1, Math.round(ms / 1000f))).orElse(60);
        if (MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())) {
            String serialized = objectMapper.writeValueAsString(segments);
            String visualContext = job.isVisualContextEnabled()
                    ? fetchVisualContext(job, message, segments) : null;
            SummaryAiClient.ScriptProposalResult result;
            if (summaryAiClient instanceof UserAwareSummaryAiClient userAware) {
                result = userAware.generateScript(serialized, visualContext, duration, job.getTargetLang(),
                        job.getId(), job.getCreatedByUserId());
            } else {
                result = summaryAiClient.generateScript(serialized, visualContext, duration, job.getTargetLang());
            }
            chargeAiUsage(job, "SUMMARIZE_SCRIPT",
                    result == null || result.usageTokens() == 0
                            ? estimateTokens(serialized + (result == null ? "" : result.scriptContent()))
                            : result.usageTokens(),
                    hasPersonalProvider(job, "TRANSLATE"));
            SummaryProposal proposal = summarizationService.persistAiProposalResult(
                    stage.getId(), (short) 1, result, null, duration);
            if (job.getWorkflowMode() == MediaJob.WorkflowMode.AUTO
                    && job.getSelectedProposalId() == null) {
                job.setSelectedProposalId(proposal.getId());
                jobRepository.save(job);
            }
            completeSuccess(job, stage, message, scriptProposalOutput(proposal));
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("correlation_id", message.correlationId().toString());
        body.put("media_job_id", job.getId().toString());
        body.put("transcript", segments);
        body.put("requested_duration_seconds", duration);
        body.put("duration_tolerance", Map.of("lower_seconds", 20, "upper_seconds", 20));
        ProviderContext provider = provider(job, "TRANSLATE");
        body.put("provider", provider.payload());
        JsonNode result = mediaAiClient.post().uri("/media/summarize").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "SUMMARIZE");
        chargeAiUsage(job, "SUMMARIZE_SCRIPT", usageUnits(result, "SUMMARIZE", serializedLength(segments)),
                provider.personalApiKey());
        completeSuccess(job, stage, message, result);
    }

    private void executeTranslate(MediaJob job, MediaJobStage stage, MediaStageMessage message) throws Exception {
        MediaJobStage source = findStage(job.getId(), MediaJobStage.StageName.SUMMARIZE);
        MediaJobStage stt = findStage(job.getId(), MediaJobStage.StageName.STT);
        JsonNode summary = parseJson(source == null ? null : source.getOutputRef());
        JsonNode transcript = parseJson(stt == null ? null : stt.getOutputRef());
        String sourceText = authoredScript(summary);
        List<SourceSubtitle> sourceSegments = translationSourceSegments(job, summary, transcript);
        if (MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())
                && job.getSelectedProposalId() != null) {
            try {
                SummaryProposal selected = summarizationService.getProposalById(job.getSelectedProposalId());
                sourceText = selected.getScriptContent();
                sourceSegments = proposalSourceSegments(selected);
            } catch (Exception ignored) {
                // The selection endpoint validates this relationship. Keep the
                // stage output fallback for an already persisted legacy job.
            }
        }
        // Script-first proposals are already authored in target_lang.  They
        // must not be translated a second time; TRANSLATE here is a durable
        // hand-off for the following TTS/RENDER stages.
        if (MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())
                && job.getSourceSummaryJobId() == null
                && sourceText != null && !sourceText.isBlank()) {
            ObjectNode authored = objectMapper.createObjectNode();
            authored.put("request_id", message.correlationId().toString());
            authored.put("status", "COMPLETED");
            authored.put("translation", sourceText);
            persistSubtitleSegments(job, sourceSegments, authored, SubtitleSegment.ContentSource.AUTHORED_SCRIPT);
            runQualityChecks(job, sourceSegments, authored);
            completeSuccess(job, stage, message, authored);
            return;
        }
        if (sourceText == null || sourceText.isBlank()) {
            sourceText = sourceSegments.stream().map(SourceSubtitle::sourceText)
                    .filter(text -> text != null && !text.isBlank()).reduce((left, right) -> left + " " + right)
                    .orElse(null);
        }
        if (sourceText == null || sourceText.isBlank()) {
            Object sourceTextOverride = jsonObject(stage.getInputRef()).get("source_text");
            sourceText = sourceTextOverride == null ? "" : sourceTextOverride.toString();
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("request_id", message.correlationId().toString());
        body.put("source_lang", job.getSourceLanguage() == null ? "auto" : job.getSourceLanguage());
        body.put("target_lang", job.getTargetLang());
        body.put("source_text", sourceText);
        body.put("glossary", glossary(job));
        ProviderContext provider = provider(job, "TRANSLATE");
        body.put("provider", provider.payload());
        JsonNode result = aiClient.post().uri("/ai/translate").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "TRANSLATE");
        chargeAiUsage(job, "TRANSLATE", usageUnits(result, "TRANSLATE", sourceText.length()),
                provider.personalApiKey());
        persistSubtitleSegments(job, sourceSegments, result, contentSource(job));
        runQualityChecks(job, sourceSegments, result);
        completeSuccess(job, stage, message, result);
    }

    private void executeTts(MediaJob job, MediaJobStage stage, MediaStageMessage message) {
        MediaJobStage translation = findStage(job.getId(), MediaJobStage.StageName.TRANSLATE);
        JsonNode translated = parseJson(translation == null ? null : translation.getOutputRef());
        String text = translated != null && translated.has("translation")
                ? translated.get("translation").asText() : String.valueOf(translated);
        Map<String, Object> segment = Map.of("segment_id", message.correlationId().toString(), "target_text", text);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("correlation_id", message.correlationId().toString());
        body.put("media_job_id", job.getId().toString());
        String voiceId = job.getTtsVoiceId() == null ? "default"
                : providerResolver.resolveVoiceIdentifier(job.getCreatedByUserId(), job.getTtsProviderId(), job.getTtsVoiceId())
                .orElse(job.getTtsVoiceId().toString());
        body.put("voice_id", voiceId);
        body.put("segments", List.of(segment));
        ProviderContext provider = provider(job, "TTS");
        body.put("provider", provider.payload());
        JsonNode result = mediaAiClient.post().uri("/media/tts").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "TTS");
        chargeAiUsage(job, "TTS", usageUnits(result, "TTS", text == null ? 0L : text.length()),
                provider.personalApiKey());
        JsonNode persisted = persistTtsAudio(job, result);
        completeSuccess(job, stage, message, persisted);
    }

    private JsonNode persistTtsAudio(MediaJob job, JsonNode response) {
        JsonNode first = response == null || !response.path("results").isArray()
                || response.path("results").isEmpty() ? null : response.path("results").get(0);
        if (first == null) return response;
        String existingRef = first.path("audio_ref").asText(null);
        if (existingRef == null || existingRef.isBlank()) {
            existingRef = first.path("audioRef").asText(null);
        }
        String base64 = first.path("audio_base64").asText(null);
        if ((existingRef == null || existingRef.isBlank()) && base64 != null && !base64.isBlank()) {
            try {
                byte[] bytes = Base64.getDecoder().decode(base64);
                String key = "dubbed/" + job.getId() + "/" + UUID.randomUUID() + ".mp3";
                storage.putMediaObject(key, new ByteArrayInputStream(bytes), bytes.length, "audio/mpeg");
                existingRef = storage.mediaBucket() + "/" + key;
            } catch (IllegalArgumentException ex) {
                throw new IllegalStateException("TTS returned invalid base64 audio", ex);
            }
        }
        ObjectNode output = objectMapper.createObjectNode();
        if (existingRef != null && !existingRef.isBlank()) output.put("objectRef", existingRef);
        output.set("response", response);
        return output;
    }

    ProviderContext provider(MediaJob job, String capability) {
        ProviderResolverService.ProviderResolution p = providerResolver.resolveForCapability(
                job.getCreatedByUserId(), capability);
        if (p.model() == null || p.model().isBlank()) {
            throw new AppException(com.app.common.exception.ErrorCode.PROVIDER_MODEL_NOT_CONFIGURED);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("protocol", p.providerType());
        payload.put("base_url", p.baseUrl());
        payload.put("api_key", p.apiKey());
        payload.put("model", p.model());
        payload.put("capabilities", List.of(providerCapability(capability)));
        log.info("Resolved provider protocol={} capability={} model={} personal={}",
                p.providerType(), capability, p.model(), p.isPersonalApiKey());
        return new ProviderContext(payload, p.isPersonalApiKey());
    }

    private String providerCapability(String capability) {
        return switch (capability == null ? "" : capability.toUpperCase(Locale.ROOT)) {
            case "STT" -> "STT";
            case "TTS" -> "TTS";
            case "VISION" -> "VISION";
            default -> "TEXT";
        };
    }

    private boolean hasPersonalProvider(MediaJob job, String capability) {
        return providerResolver.resolveForCapability(job.getCreatedByUserId(), capability).isPersonalApiKey();
    }

    /** Charge only after the FastAPI stage has returned COMPLETED. */
    private void chargeAiUsage(MediaJob job, String capability, long units, boolean personalApiKey) {
        if (creditService == null) {
            return;
        }
        long billableUnits = Math.max(1L, units);
        java.math.BigDecimal creditUsed = creditService.chargeUsage(
                job.getWorkspaceId(), job.getCreatedByUserId(), capability, billableUnits, personalApiKey);
        if (aiUsageLogService != null) {
            try {
                aiUsageLogService.record(job.getWorkspaceId(), job.getProjectId(), job.getId(),
                        job.getCreatedByUserId(), capability, personalApiKey, billableUnits, creditUsed);
            } catch (Exception ex) {
                // Usage logging must not turn a successfully charged/completed AI
                // stage into a retry (the credit transaction is already durable).
                log.warn("AI usage log failed for job={} operation={}: {}",
                        job.getId(), capability, ex.getMessage());
            }
        }
    }

    private long usageUnits(JsonNode result, String operation, long fallbackUnits) {
        JsonNode usage = result == null ? null : result.get("usage");
        if (usage != null && usage.isObject()) {
            long tokenUnits = usage.path("total_tokens").asLong(0L);
            if (tokenUnits == 0L) {
                tokenUnits = usage.path("input_tokens").asLong(0L)
                        + usage.path("output_tokens").asLong(0L);
            }
            if (tokenUnits > 0L) {
                return tokenUnits;
            }
            if ("STT".equals(operation)) {
                double seconds = usage.path("audio_seconds").asDouble(0.0);
                if (seconds > 0.0) {
                    return Math.max(1L, Math.round(seconds));
                }
            }
            if ("TTS".equals(operation)) {
                long characters = usage.path("characters").asLong(0L);
                if (characters > 0L) {
                    return characters;
                }
            }
        }
        long fallback = fallbackUnits;
        if ("STT".equals(operation) && fallback > 1000L) {
            fallback = Math.round(fallback / 1000.0d);
        }
        return Math.max(1L, fallback);
    }

    private long estimateTokens(String text) {
        if (text == null || text.isBlank()) {
            return 1L;
        }
        return Math.max(1L, (text.codePointCount(0, text.length()) + 3L) / 4L);
    }

    private long serializedLength(List<Map<String, Object>> segments) {
        if (segments == null || segments.isEmpty()) {
            return 1L;
        }
        return Math.max(1L, segments.stream()
                .map(segment -> String.valueOf(segment.getOrDefault("text", "")))
                .mapToLong(String::length)
                .sum());
    }

    /**
     * FastAPI owns frame sampling and VLM calls. Spring only supplies the signed
     * source URL, transcript context and the resolved VISION provider.
     */
    private String fetchVisualContext(MediaJob job, MediaStageMessage message,
                                      List<Map<String, Object>> transcript) {
        try {
            MediaAsset asset = assetRepository.findById(job.getRootAssetId()).orElseThrow();
            String sourceRef = asset.getBucketName() + "/" + asset.getObjectStorageKey();
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("correlation_id", message.correlationId().toString());
            body.put("media_job_id", job.getId().toString());
            body.put("video_ref", sourceRef);
            body.put("video_url", storage.presignedGetUrl(sourceRef));
            body.put("sampling_config", Map.of(
                    "interval_ms", 3_000,
                    "scene_aware", true,
                    "max_frames", 12,
                    "cost_per_image_tokens", 800,
                    "prompt_version", "v1"));
            body.put("transcript", transcript == null ? List.of() : transcript);
            if (asset.getDurationMs() != null) {
                body.put("video_duration_ms", asset.getDurationMs());
            }
            ProviderContext provider = provider(job, "VISION");
            body.put("provider", provider.payload());

            JsonNode result = aiClient.post().uri("/media/understand/visual")
                    .contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(JsonNode.class);
            if (result == null || !"COMPLETED".equalsIgnoreCase(result.path("status").asText())) {
                log.warn("Visual context unavailable for job={}", job.getId());
                return null;
            }
            JsonNode context = result.get("multimodal_context");
            if (context == null || context.isNull()) {
                ObjectNode fallback = objectMapper.createObjectNode();
                fallback.set("visual_observations", result.path("observations"));
                fallback.set("visual_scenes", result.path("scenes"));
                context = fallback;
            }
            chargeAiUsage(job, "VISION", usageUnits(result, "VISION",
                    Math.max(1L, result.path("frame_samples").size() * 800L)), provider.personalApiKey());
            return objectMapper.writeValueAsString(context);
        } catch (AppException ex) {
            // Credit failures are business failures, not an optional VLM outage.
            // Propagate them so the stage cannot continue without charging usage.
            throw ex;
        } catch (Exception ex) {
            // Visual context is explicitly optional. A provider/storage failure
            // falls back to transcript-only summarisation and is observable here.
            log.warn("Visual context failed for job={}: {}", job.getId(), ex.getMessage());
            return null;
        }
    }

    private List<Map<String, Object>> glossary(MediaJob job) {
        if (glossaryService == null) {
            return List.of();
        }
        try {
            List<Map<String, Object>> result = new ArrayList<>();
            for (GlossaryTerm term : glossaryService.listTerms(job.getWorkspaceId(), job.getCreatedByUserId(), job.getProjectId())) {
                if (term.getTargetLang() != null && job.getTargetLang() != null
                        && !term.getTargetLang().equalsIgnoreCase(job.getTargetLang())) {
                    continue;
                }
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("source", term.getSourceTerm());
                item.put("target", term.getTargetTerm());
                item.put("case_sensitive", false);
                item.put("note", term.getTargetLang());
                result.add(item);
            }
            return result;
        } catch (Exception ex) {
            log.warn("Glossary unavailable for job={}: {}", job.getId(), ex.getMessage());
            return List.of();
        }
    }

    private List<SourceSubtitle> translationSourceSegments(MediaJob job, JsonNode summary,
                                                            JsonNode transcript) {
        if (MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())) {
            if (job.getSelectedProposalId() != null) {
                try {
                    return proposalSourceSegments(summarizationService.getProposalById(job.getSelectedProposalId()));
                } catch (Exception ignored) {
                    // The selected proposal is validated by the service before dispatch.
                }
            }
            if (job.getSourceSummaryJobId() == null) {
                List<SourceSubtitle> scripted = scriptSourceSegments(summary == null ? null : summary.get("segments"));
                if (!scripted.isEmpty()) {
                    return scripted;
                }
            }
        }

        JsonNode source = transcript != null && transcript.path("segments").isArray()
                ? transcript.path("segments") : transcript;
        JsonNode ranges = firstCutRanges(summary);
        List<SourceSubtitle> result = new ArrayList<>();
        if (source != null && source.isArray()) {
            for (JsonNode item : source) {
                long start = longValue(item, "start_ms", "startMs", 0L);
                long end = longValue(item, "end_ms", "endMs", start + 1L);
                String text = firstText(item, "text", "source_text", "script_excerpt");
                if (ranges != null && ranges.isArray() && !ranges.isEmpty()
                        && !overlapsAny(start, end, ranges)) {
                    continue;
                }
                result.add(new SourceSubtitle(text, Math.max(0L, start), Math.max(start + 1L, end)));
            }
        }
        return result;
    }

    private List<SourceSubtitle> scriptSourceSegments(JsonNode segments) {
        List<SourceSubtitle> result = new ArrayList<>();
        if (segments == null || !segments.isArray()) {
            return result;
        }
        for (JsonNode item : segments) {
            long start = longValue(item, "start_ms", "startMs", 0L);
            long end = longValue(item, "end_ms", "endMs", start + 1L);
            String text = firstText(item, "script_excerpt", "scriptExcerpt", "text");
            if (text != null && !text.isBlank()) {
                result.add(new SourceSubtitle(text, Math.max(0L, start), Math.max(start + 1L, end)));
            }
        }
        return result;
    }

    private List<SourceSubtitle> proposalSourceSegments(SummaryProposal proposal) {
        List<SourceSubtitle> result = new ArrayList<>();
        for (SummaryProposalSegment segment : summarizationService.getSegments(proposal.getId())) {
            String text = segment.getScriptExcerpt();
            result.add(new SourceSubtitle(text,
                    Math.max(0L, segment.getStartMs()),
                    Math.max(segment.getStartMs() + 1L, segment.getEndMs())));
        }
        if (result.isEmpty() && proposal.getScriptContent() != null && !proposal.getScriptContent().isBlank()) {
            result.add(new SourceSubtitle(proposal.getScriptContent(), 0L,
                    Math.max(1L, proposal.getTotalDurationMs())));
        }
        return result;
    }

    private JsonNode firstCutRanges(JsonNode summary) {
        if (summary == null || !summary.path("proposals").isArray() || summary.path("proposals").isEmpty()) {
            return null;
        }
        JsonNode first = summary.path("proposals").get(0);
        JsonNode ranges = first.get("cut_ranges");
        return ranges != null && ranges.isArray() ? ranges : first.get("cutRanges");
    }

    private boolean overlapsAny(long start, long end, JsonNode ranges) {
        for (JsonNode range : ranges) {
            long rangeStart = longValue(range, "start_ms", "startMs", 0L);
            long rangeEnd = longValue(range, "end_ms", "endMs", 0L);
            if (start < rangeEnd && end > rangeStart) {
                return true;
            }
        }
        return false;
    }

    private SubtitleSegment.ContentSource contentSource(MediaJob job) {
        if (!MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())) {
            return SubtitleSegment.ContentSource.TRANSLATED_ORIGINAL;
        }
        return job.getSourceSummaryJobId() == null
                ? SubtitleSegment.ContentSource.AUTHORED_SCRIPT
                : SubtitleSegment.ContentSource.TRANSLATED_SCRIPT;
    }

    /** Persist the timed subtitle projection consumed by the editor, export and render paths. */
    private void persistSubtitleSegments(MediaJob job, List<SourceSubtitle> sourceSegments,
                                         JsonNode translation, SubtitleSegment.ContentSource source) {
        if (subtitleSegmentRepository == null) {
            return;
        }
        List<SourceSubtitle> sources = sourceSegments == null ? new ArrayList<>() : new ArrayList<>(sourceSegments);
        String fullTranslation = translatedText(translation);
        if (sources.isEmpty()) {
            long duration = assetRepository.findById(job.getRootAssetId()).map(MediaAsset::getDurationMs).orElse(1_000L);
            sources.add(new SourceSubtitle(
                    source == SubtitleSegment.ContentSource.AUTHORED_SCRIPT ? fullTranslation : null,
                    0L, Math.max(1L, duration)));
        }

        List<TargetSubtitle> responseSegments = translatedSegments(translation);
        List<String> targetTexts;
        if (source == SubtitleSegment.ContentSource.AUTHORED_SCRIPT) {
            targetTexts = sources.stream().map(SourceSubtitle::sourceText).toList();
        } else if (responseSegments.size() == sources.size()) {
            targetTexts = responseSegments.stream().map(TargetSubtitle::text).toList();
        } else {
            targetTexts = splitText(fullTranslation, sources);
        }

        subtitleSegmentRepository.deleteByMediaJobId(job.getId());
        List<SubtitleSegment> persisted = new ArrayList<>();
        for (int i = 0; i < sources.size(); i++) {
            SourceSubtitle sourceSegment = sources.get(i);
            String target = i < targetTexts.size() ? targetTexts.get(i) : "";
            if (target == null || target.isBlank()) {
                target = source == SubtitleSegment.ContentSource.AUTHORED_SCRIPT
                        ? sourceSegment.sourceText() : "";
            }
            if (target.isBlank()) {
                continue;
            }
            long start = sourceSegment.startMs();
            long end = sourceSegment.endMs();
            if (responseSegments.size() == sources.size()) {
                start = responseSegments.get(i).startMs() >= 0 ? responseSegments.get(i).startMs() : start;
                end = responseSegments.get(i).endMs() > start ? responseSegments.get(i).endMs() : end;
            }
            SubtitleSegment segment = new SubtitleSegment();
            segment.setMediaJobId(job.getId());
            segment.setSeq(i + 1);
            segment.setContentSource(source);
            segment.setSourceText(sourceSegment.sourceText());
            segment.setTargetText(target.trim());
            segment.setStartMs(Math.max(0L, start));
            segment.setEndMs(Math.max(Math.max(0L, start) + 1L, end));
            persisted.add(segment);
        }
        subtitleSegmentRepository.saveAll(persisted);
    }

    private List<TargetSubtitle> translatedSegments(JsonNode result) {
        List<TargetSubtitle> segments = new ArrayList<>();
        JsonNode raw = result == null ? null : result.get("segments");
        if (raw == null || !raw.isArray()) {
            return segments;
        }
        for (JsonNode item : raw) {
            String text = firstText(item, "translation", "translated_text", "target_text", "text", "script_excerpt");
            if (text == null || text.isBlank()) {
                continue;
            }
            long start = longValue(item, "start_ms", "startMs", -1L);
            long end = longValue(item, "end_ms", "endMs", -1L);
            segments.add(new TargetSubtitle(text, start, end));
        }
        return segments;
    }

    private String translatedText(JsonNode result) {
        if (result == null || result.isNull()) {
            return "";
        }
        if (result.isTextual()) {
            return result.asText();
        }
        String text = firstText(result, "translation", "translated_text", "target_text",
                "script_content", "scriptContent", "text");
        return text == null ? "" : text;
    }

    private List<String> splitText(String text, List<SourceSubtitle> sources) {
        if (sources.size() <= 1) {
            return List.of(text == null ? "" : text.trim());
        }
        String normalized = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        if (normalized.isBlank()) {
            return sources.stream().map(SourceSubtitle::sourceText).toList();
        }
        long totalWeight = sources.stream()
                .mapToLong(s -> Math.max(1L, s.sourceText() == null ? 1 : s.sourceText().length()))
                .sum();
        List<String> result = new ArrayList<>();
        int cursor = 0;
        for (int i = 0; i < sources.size(); i++) {
            if (i == sources.size() - 1) {
                result.add(normalized.substring(Math.min(cursor, normalized.length())).trim());
                break;
            }
            long weight = Math.max(1L, sources.get(i).sourceText() == null ? 1 : sources.get(i).sourceText().length());
            int desired = cursor + Math.max(1, (int) Math.round((double) normalized.length() * weight / totalWeight));
            desired = Math.min(normalized.length(), desired);
            int boundary = desired;
            while (boundary < normalized.length() && !Character.isWhitespace(normalized.charAt(boundary))) {
                boundary++;
            }
            if (boundary <= cursor && cursor < normalized.length()) {
                boundary = Math.min(normalized.length(), cursor + 1);
            }
            result.add(normalized.substring(Math.min(cursor, normalized.length()), boundary).trim());
            cursor = boundary;
            while (cursor < normalized.length() && Character.isWhitespace(normalized.charAt(cursor))) {
                cursor++;
            }
        }
        while (result.size() < sources.size()) {
            result.add("");
        }
        return result;
    }

    private void runQualityChecks(MediaJob job, List<SourceSubtitle> sourceSegments, JsonNode translation) {
        if (subtitleSegmentRepository == null || qaService == null) {
            return;
        }
        List<SubtitleSegment> segments = subtitleSegmentRepository.findByMediaJobIdOrderBySeq(job.getId());
        if (segments.isEmpty()) {
            return;
        }
        Set<String> recorded = new HashSet<>();
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("request_id", UUID.randomUUID().toString());
            body.put("source_lang", job.getSourceLanguage() == null ? "auto" : job.getSourceLanguage());
            body.put("target_lang", job.getTargetLang());
            body.put("source_text", joinSegmentText(segments, true));
            body.put("translated_text", joinSegmentText(segments, false));
            body.put("glossary", glossary(job));
            body.put("checks", List.of("accuracy", "fluency", "terminology", "length", "timing"));
            body.put("provider", provider(job, "TRANSLATE").payload());
            JsonNode response = aiClient.post().uri("/ai/qa")
                    .contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(JsonNode.class);
            if (response != null && "COMPLETED".equalsIgnoreCase(response.path("status").asText())
                    && response.path("issues").isArray()) {
                for (JsonNode issue : response.path("issues")) {
                    SubtitleSegment segment = locateQaSegment(segments, issue);
                    if (segment == null) {
                        continue;
                    }
                    String type = firstText(issue, "type", "issue_type");
                    type = type == null || type.isBlank() ? "ai_qa_issue" : type;
                    String key = segment.getId() + ":" + type;
                    if (recorded.add(key)) {
                        qaService.recordIssue(segment.getId(), type, qaSeverity(issue.path("severity").asText()),
                                qaBlockingActions(issue.path("blocking_actions")), writeJson(issue));
                    }
                }
            } else {
                log.warn("QA service returned no completed result for job={}", job.getId());
            }
        } catch (Exception ex) {
            // QA is a quality gate, but a provider outage must not erase the
            // already persisted subtitle output. Deterministic checks below
            // still protect malformed timing from silently reaching RENDER.
            log.warn("AI QA failed for job={}: {}", job.getId(), ex.getMessage());
        }
        recordDeterministicQa(segments, recorded);
    }

    private String joinSegmentText(List<SubtitleSegment> segments, boolean source) {
        return segments.stream()
                .map(segment -> source ? segment.getSourceText() : segment.getTargetText())
                .filter(text -> text != null && !text.isBlank())
                .reduce((left, right) -> left + "\n" + right)
                .orElse("");
    }

    private SubtitleSegment locateQaSegment(List<SubtitleSegment> segments, JsonNode issue) {
        String sourceSpan = firstText(issue, "source_span", "sourceSpan");
        String targetSpan = firstText(issue, "target_span", "targetSpan");
        for (SubtitleSegment segment : segments) {
            if ((sourceSpan != null && containsIgnoreCase(segment.getSourceText(), sourceSpan))
                    || (targetSpan != null && containsIgnoreCase(segment.getTargetText(), targetSpan))) {
                return segment;
            }
        }
        return segments.get(0);
    }

    private boolean containsIgnoreCase(String value, String needle) {
        return value != null && needle != null
                && value.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
    }

    private QaIssue.Severity qaSeverity(String raw) {
        try {
            return QaIssue.Severity.valueOf(raw == null ? "MEDIUM" : raw.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return QaIssue.Severity.MEDIUM;
        }
    }

    private List<String> qaBlockingActions(JsonNode raw) {
        List<String> actions = new ArrayList<>();
        if (raw != null && raw.isArray()) {
            for (JsonNode action : raw) {
                String value = action.asText("").toUpperCase(Locale.ROOT);
                if ("BLOCK_EXPORT".equals(value)) {
                    value = "BLOCK_PUBLISH";
                }
                if (Set.of("BLOCK_APPROVAL", "BLOCK_PUBLISH", "BLOCK_RENDER").contains(value)
                        && !actions.contains(value)) {
                    actions.add(value);
                }
            }
        }
        return actions;
    }

    private void recordDeterministicQa(List<SubtitleSegment> segments, Set<String> recorded) {
        for (int i = 0; i < segments.size(); i++) {
            SubtitleSegment current = segments.get(i);
            if (current.getEndMs() <= current.getStartMs()) {
                recordLocalQa(current, "invalid_timing", QaIssue.Severity.CRITICAL,
                        List.of("BLOCK_RENDER"), "Subtitle end must be after start", recorded);
            }
            if (i > 0) {
                SubtitleSegment previous = segments.get(i - 1);
                if (current.getStartMs() < previous.getEndMs()) {
                    recordLocalQa(current, "subtitle_overlap", QaIssue.Severity.CRITICAL,
                            List.of("BLOCK_RENDER"), "Subtitle timing overlaps the previous segment", recorded);
                }
            }
        }
    }

    private void recordLocalQa(SubtitleSegment segment, String type, QaIssue.Severity severity,
                               List<String> blockingActions, String detail, Set<String> recorded) {
        if (!recorded.add(segment.getId() + ":" + type)) {
            return;
        }
        qaService.recordIssue(segment.getId(), type, severity, blockingActions,
                "{\"message\":" + quoteJson(detail) + "}");
    }

    private String quoteJson(String value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ignored) {
            return "\"QA issue\"";
        }
    }

    private String writeJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (Exception ignored) {
            return "{}";
        }
    }

    private void completeSuccess(MediaJob job, MediaJobStage stage, MediaStageMessage message, JsonNode output) {
        callbackService.completeStage(job.getId(), stage.getId(), stage.getStageName(), true, output, null);
    }

    private void completeFailure(MediaJob job, MediaJobStage stage, MediaStageMessage message,
                                 AiStageException failure) {
        JsonNode detail = objectMapper.valueToTree(failure.getErrorDetail());
        callbackService.completeStage(job.getId(), stage.getId(), stage.getStageName(), false, null,
                failure.getMessage(), failure.getErrorCode(), detail);
    }

    private void ensureCompleted(JsonNode result, String stage) {
        if (result == null || !"COMPLETED".equalsIgnoreCase(result.path("status").asText())) {
            if (result != null && "FAILED".equalsIgnoreCase(result.path("status").asText())) {
                throw AiStageException.fromOperationResponse(result);
            }
            throw AiStageException.safeFailure("PROVIDER_RESPONSE_MALFORMED",
                    "AI provider returned an incomplete response", false,
                    "Check the configured provider model and try the provider test again.", null, null);
        }
    }

    private MediaJobStage findStage(UUID jobId, MediaJobStage.StageName name) {
        return stageRepository.findByMediaJobIdAndStageName(jobId, name).orElse(null);
    }

    private Map<String, Object> jsonObject(String raw) {
        if (raw == null || raw.isBlank()) return new LinkedHashMap<>();
        try {
            JsonNode node = objectMapper.readTree(raw);
            if (node != null && node.isObject()) return objectMapper.convertValue(node, Map.class);
        } catch (Exception ignored) {
            // Input refs are optional context; validation at the downstream worker remains authoritative.
        }
        return new LinkedHashMap<>();
    }

    private JsonNode parseJson(String raw) {
        if (raw == null || raw.isBlank()) return objectMapper.createObjectNode();
        try { return objectMapper.readTree(raw); } catch (Exception ignored) {
            return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.textNode(raw);
        }
    }

    private String objectRef(String raw) {
        if (raw == null || raw.isBlank()) return null;
        JsonNode node = parseJson(raw);
        if (node.isTextual()) return node.asText();
        JsonNode value = node.get("objectRef");
        if (value != null && !value.isNull()) return value.asText();
        JsonNode stems = node.get("stems");
        if (stems != null && stems.isArray()) {
            for (JsonNode stem : stems) {
                if ("VOCAL".equalsIgnoreCase(stem.path("role").asText())) {
                    JsonNode ref = stem.get("objectRef");
                    if (ref != null && !ref.isNull()) return ref.asText();
                }
            }
            if (!stems.isEmpty()) {
                JsonNode ref = stems.get(0).get("objectRef");
                if (ref != null && !ref.isNull()) return ref.asText();
            }
        }
        return null;
    }

    private List<Map<String, Object>> transcriptSegments(JsonNode node) {
        JsonNode segments = node == null ? null : node.has("segments") ? node.get("segments") : node;
        List<Map<String, Object>> result = new ArrayList<>();
        if (segments != null && segments.isArray()) {
            for (JsonNode item : segments) result.add(objectMapper.convertValue(item, Map.class));
        }
        return result;
    }

    private String authoredScript(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return null;
        for (String field : List.of("script_content", "scriptContent")) {
            JsonNode value = node.get(field);
            if (value != null && value.isTextual() && !value.asText().isBlank()) return value.asText();
        }
        return null;
    }

    /** Resolve the source text for both Localization (extractive cut plan) and script-first jobs. */
    private String transcriptTextForSummary(JsonNode summary, JsonNode transcript) {
        List<JsonNode> selected = new ArrayList<>();
        JsonNode ranges = null;
        if (summary != null && summary.path("proposals").isArray()
                && !summary.path("proposals").isEmpty()) {
            JsonNode first = summary.path("proposals").get(0);
            ranges = first.has("cut_ranges") ? first.get("cut_ranges") : first.get("cutRanges");
        }
        JsonNode sourceSegments = transcript != null && transcript.path("segments").isArray()
                ? transcript.path("segments") : transcript;
        if (sourceSegments == null || !sourceSegments.isArray()) return null;
        for (JsonNode segment : sourceSegments) {
            boolean keep = ranges == null || !ranges.isArray() || ranges.isEmpty();
            if (!keep) {
                long start = segment.path("start_ms").asLong(segment.path("startMs").asLong(0));
                long end = segment.path("end_ms").asLong(segment.path("endMs").asLong(0));
                for (JsonNode range : ranges) {
                    long rangeStart = range.path("start_ms").asLong(range.path("startMs").asLong(0));
                    long rangeEnd = range.path("end_ms").asLong(range.path("endMs").asLong(0));
                    if (start < rangeEnd && end > rangeStart) {
                        keep = true;
                        break;
                    }
                }
            }
            if (keep) selected.add(segment);
        }
        return selected.stream()
                .map(node -> node.path("text").asText(""))
                .filter(text -> !text.isBlank())
                .reduce((left, right) -> left + " " + right)
                .orElse(null);
    }

    private JsonNode scriptProposalOutput(SummaryProposal proposal) {
        ObjectNode output = objectMapper.createObjectNode();
        output.put("status", "COMPLETED");
        output.put("script_content", proposal.getScriptContent());
        output.put("script_language", proposal.getScriptLanguage());
        output.put("reasoning_note", proposal.getReasoningNote());
        if (proposal.getConfidence() != null) output.put("confidence", proposal.getConfidence());
        try {
            output.set("warnings", objectMapper.readTree(proposal.getWarnings() == null ? "[]" : proposal.getWarnings()));
        } catch (Exception ignored) {
            output.putArray("warnings");
        }
        var segments = output.putArray("segments");
        for (SummaryProposalSegment segment : summarizationService.getSegments(proposal.getId())) {
            ObjectNode item = segments.addObject();
            item.put("start_ms", segment.getStartMs());
            item.put("end_ms", segment.getEndMs());
            item.put("script_excerpt", segment.getScriptExcerpt());
            try {
                item.set("source_sentence_refs", objectMapper.readTree(
                        segment.getSourceSentenceRefs() == null ? "[]" : segment.getSourceSentenceRefs()));
            } catch (Exception ignored) {
                item.putArray("source_sentence_refs");
            }
            item.put("reasoning_note", segment.getReasoningNote());
        }
        return output;
    }

    private Map<String, Object> copyMap(Object value) {
        return mapValue(value);
    }

    private Map<String, Object> mapValue(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() != null) {
                    result.put(String.valueOf(entry.getKey()), entry.getValue());
                }
            }
        }
        return result;
    }

    private void putIfNotNull(Map<String, Object> target, String key, Object value) {
        if (value != null) {
            target.put(key, value);
        }
    }

    private String stringValue(Object value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? fallback : text;
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }

    private String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }

    private boolean booleanValue(Object value, boolean fallback) {
        if (value instanceof Boolean bool) {
            return bool;
        }
        return value == null ? fallback : Boolean.parseBoolean(String.valueOf(value));
    }

    private Boolean booleanOrNull(Object value) {
        if (value instanceof Boolean bool) {
            return bool;
        }
        return value == null ? null : Boolean.valueOf(String.valueOf(value));
    }

    private int intValue(Object value, int fallback) {
        Integer parsed = integerOrNull(value);
        return parsed == null ? fallback : parsed;
    }

    private Integer integerOrNull(Object value) {
        if (value instanceof Number number) {
            return (int) Math.round(number.doubleValue());
        }
        if (value == null) {
            return null;
        }
        try {
            return Integer.valueOf(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private double doubleValue(Object value, double fallback) {
        Double parsed = doubleOrNull(value);
        return parsed == null ? fallback : parsed;
    }

    private Double doubleOrNull(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        if (value == null) {
            return null;
        }
        try {
            return Double.valueOf(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private long longValue(JsonNode node, String primary, String secondary, long fallback) {
        if (node == null) {
            return fallback;
        }
        JsonNode value = node.get(primary);
        if (value == null || value.isNull()) {
            value = node.get(secondary);
        }
        return value == null || !value.isNumber() && !value.isTextual()
                ? fallback : value.asLong(fallback);
    }

    private String firstText(JsonNode node, String... fields) {
        if (node == null) {
            return null;
        }
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value != null && !value.isNull() && value.isValueNode()) {
                String text = value.asText();
                if (text != null && !text.isBlank()) {
                    return text;
                }
            }
        }
        return null;
    }

    record ProviderContext(Map<String, Object> payload, boolean personalApiKey) {
    }

    private record SourceSubtitle(String sourceText, long startMs, long endMs) {
    }

    private record TargetSubtitle(String text, long startMs, long endMs) {
    }

    private String srtTimestamp(long milliseconds) {
        long total = Math.max(0, milliseconds);
        long hours = total / 3_600_000;
        long minutes = (total % 3_600_000) / 60_000;
        long seconds = (total % 60_000) / 1_000;
        long millis = total % 1_000;
        return String.format("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis);
    }
}
