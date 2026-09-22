package com.app.modules.media_job.pipeline;

import com.app.common.config.AppProperties;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.repository.MediaAssetRepository;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.provider.service.ProviderResolverService;
import com.app.modules.summarization.service.SummaryAiClient;
import com.app.modules.summarization.service.SummarizationService;
import com.app.modules.summarization.entity.SummaryProposal;
import com.app.modules.summarization.entity.SummaryProposalSegment;
import com.app.modules.summarization.service.UserAwareSummaryAiClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    private final RestClient workerClient;
    private final AppProperties props;

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
        this.aiClient = RestClient.builder().baseUrl(props.ai().baseUrl()).build();
        this.workerClient = RestClient.builder().baseUrl(props.mediaWorker().baseUrl()).build();
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
            log.warn("Media stage failed before callback job={} stage={}: {}",
                    message.jobId(), stage.getStageName(), ex.getMessage());
            completeFailure(job, stage, message, ex.getMessage());
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
            }
            case RENDER -> {
                path = "/internal/media/render";
                body.putIfAbsent("source_video_ref", sourceRef);
                body.putIfAbsent("callback_base_url", props.mediaWorker().callbackBaseUrl());
                long duration = asset.getDurationMs() == null ? 60_000L : asset.getDurationMs();
                body.putIfAbsent("cut_ranges", defaultCutRanges(job, duration));
                body.putIfAbsent("audio_input_version", "1");
                addDefaultRenderAudio(job, body, duration);
                body.putIfAbsent("subtitle_track", defaultSubtitleTrack(job, duration));
            }
            default -> throw new IllegalStateException("Not a worker stage");
        }
        workerClient.post().uri(path).contentType(MediaType.APPLICATION_JSON).body(body)
                .retrieve().toBodilessEntity();
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
        String key = "subtitles/" + job.getId() + "/empty.srt";
        String text = translatedSubtitleText(job);
        String end = srtTimestamp(Math.max(1, duration));
        String content = "1\n00:00:00,000 --> " + end + "\n"
                + (text == null ? "" : text.replace("\r", "").replace("\n", " ").trim()) + "\n";
        byte[] subtitle = content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        storage.putMediaObject(key, new ByteArrayInputStream(subtitle), subtitle.length, "application/x-subrip");
        return new LinkedHashMap<>(Map.of(
                "format", "srt",
                "content_ref", storage.mediaBucket() + "/" + key,
                "mode", job.getSubtitleMode() == null ? "SOFT_SUB" : job.getSubtitleMode().name(),
                "position", "BOTTOM",
                "background_box", true));
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
        JsonNode result = aiClient.post().uri("/media/source-separate")
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
        body.put("provider", provider(job, "STT"));
        JsonNode result = aiClient.post().uri("/media/stt").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "STT");
        completeSuccess(job, stage, message, result);
    }

    private void executeSummarize(MediaJob job, MediaJobStage stage, MediaStageMessage message) throws Exception {
        MediaJobStage stt = findStage(job.getId(), MediaJobStage.StageName.STT);
        JsonNode transcript = parseJson(stt == null ? null : stt.getOutputRef());
        List<Map<String, Object>> segments = transcriptSegments(transcript);
        int duration = job.getRequestedDurationSeconds() != null ? job.getRequestedDurationSeconds()
                : assetRepository.findById(job.getRootAssetId()).map(MediaAsset::getDurationMs)
                .map(ms -> Math.max(1, Math.round(ms / 2000f))).orElse(60);
        if (MediaJob.RECIPE_SUMMARY_SCRIPT_MATCH.equals(job.getRecipeId())) {
            String serialized = objectMapper.writeValueAsString(segments);
            SummaryAiClient.ScriptProposalResult result;
            if (summaryAiClient instanceof UserAwareSummaryAiClient userAware) {
                result = userAware.generateScript(serialized, null, duration, job.getTargetLang(),
                        job.getId(), job.getCreatedByUserId());
            } else {
                result = summaryAiClient.generateScript(serialized, null, duration, job.getTargetLang());
            }
            SummaryProposal proposal = summarizationService.persistAiProposalResult(
                    stage.getId(), (short) 0, result, null, duration);
            completeSuccess(job, stage, message, scriptProposalOutput(proposal));
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("correlation_id", message.correlationId().toString());
        body.put("media_job_id", job.getId().toString());
        body.put("transcript", segments);
        body.put("requested_duration_seconds", duration);
        body.put("duration_tolerance", Map.of("lower_seconds", 20, "upper_seconds", 20));
        body.put("provider", provider(job, "TRANSLATE"));
        JsonNode result = aiClient.post().uri("/media/summarize").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "SUMMARIZE");
        completeSuccess(job, stage, message, result);
    }

    private void executeTranslate(MediaJob job, MediaJobStage stage, MediaStageMessage message) throws Exception {
        MediaJobStage source = findStage(job.getId(), MediaJobStage.StageName.SUMMARIZE);
        MediaJobStage stt = findStage(job.getId(), MediaJobStage.StageName.STT);
        JsonNode summary = parseJson(source == null ? null : source.getOutputRef());
        JsonNode transcript = parseJson(stt == null ? null : stt.getOutputRef());
        String sourceText = authoredScript(summary);
        if ((sourceText == null || sourceText.isBlank())
                && job.getSourceSummaryJobId() != null && job.getSelectedProposalId() != null) {
            SummaryProposal selected = summarizationService.getProposalById(job.getSelectedProposalId());
            sourceText = selected.getScriptContent();
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
            completeSuccess(job, stage, message, authored);
            return;
        }
        if (sourceText == null || sourceText.isBlank()) {
            sourceText = transcriptTextForSummary(summary, transcript);
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
        body.put("provider", provider(job, "TRANSLATE"));
        JsonNode result = aiClient.post().uri("/ai/translate").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "TRANSLATE");
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
        body.put("provider", provider(job, "TTS"));
        JsonNode result = aiClient.post().uri("/media/tts").contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(JsonNode.class);
        ensureCompleted(result, "TTS");
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

    private Map<String, Object> provider(MediaJob job, String capability) {
        try {
            ProviderResolverService.ProviderResolution p = providerResolver.resolveForCapability(
                    job.getCreatedByUserId(), capability);
            return Map.of("protocol", p.providerType(), "base_url", p.endpointUrl(),
                    "api_key", p.apiKey() == null ? "" : p.apiKey(), "model", "");
        } catch (Exception ignored) {
            return Map.of("protocol", "openai_compatible", "base_url", props.ai().baseUrl(),
                    "api_key", "", "model", "");
        }
    }

    private void completeSuccess(MediaJob job, MediaJobStage stage, MediaStageMessage message, JsonNode output) {
        callbackService.completeStage(job.getId(), stage.getId(), stage.getStageName(), true, output, null);
    }

    private void completeFailure(MediaJob job, MediaJobStage stage, MediaStageMessage message, String error) {
        callbackService.completeStage(job.getId(), stage.getId(), stage.getStageName(), false, null,
                error == null ? "Stage execution failed" : error);
    }

    private void ensureCompleted(JsonNode result, String stage) {
        if (result == null || (result.has("status") && !"COMPLETED".equalsIgnoreCase(result.get("status").asText()))) {
            throw new IllegalStateException(stage + " returned a non-completed response");
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

    private String translatedSubtitleText(MediaJob job) {
        MediaJobStage translated = findStage(job.getId(), MediaJobStage.StageName.TRANSLATE);
        JsonNode node = parseJson(translated == null ? null : translated.getOutputRef());
        if (node == null || node.isNull()) return null;
        JsonNode value = node.get("translation");
        if (value == null) value = node.get("scriptContent");
        return value != null && value.isTextual() ? value.asText() : null;
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

    private String srtTimestamp(long milliseconds) {
        long total = Math.max(0, milliseconds);
        long hours = total / 3_600_000;
        long minutes = (total % 3_600_000) / 60_000;
        long seconds = (total % 60_000) / 1_000;
        long millis = total % 1_000;
        return String.format("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis);
    }
}
