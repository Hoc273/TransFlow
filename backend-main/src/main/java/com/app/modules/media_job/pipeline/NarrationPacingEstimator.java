package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Estimates how many characters per second the job's voice reads, from the
 * measured TTS of the author's earlier jobs in the same language. The original
 * pipeline used a fixed 14 chars/s (with a few hand-calibrated voices); real
 * voices differ (DashScope Vietnamese measured ~17.4), which left narrated
 * summaries up to 40 % short. Preference: same voice, then same provider, then
 * any voice in the language; {@code null} lets the AI gateway use its default.
 */
@Component
public class NarrationPacingEstimator {

    /** Less measured speech than this is too noisy to calibrate from. */
    static final long MIN_EVIDENCE_MS = 60_000L;
    private static final double MIN_CPS = 5.0;
    private static final double MAX_CPS = 40.0;

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final SubtitleSegmentRepository subtitleSegmentRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public NarrationPacingEstimator(MediaJobRepository jobRepository,
                                    MediaJobStageRepository stageRepository,
                                    SubtitleSegmentRepository subtitleSegmentRepository) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.subtitleSegmentRepository = subtitleSegmentRepository;
    }

    public Double estimateCps(MediaJob job) {
        if (job.getCreatedByUserId() == null || job.getTargetLang() == null) {
            return null;
        }
        long[] sameVoice = new long[2];
        long[] sameProvider = new long[2];
        long[] anyVoice = new long[2];
        for (MediaJob past : jobRepository.findTop20ByCreatedByUserIdAndTargetLangAndIdNotOrderByCreatedAtDesc(
                job.getCreatedByUserId(), job.getTargetLang(), job.getId())) {
            long[] sample = measuredSpeech(past);
            if (sample[1] <= 0L) {
                continue;
            }
            boolean provider = job.getTtsProviderId() != null
                    && Objects.equals(job.getTtsProviderId(), past.getTtsProviderId());
            if (provider && job.getTtsVoiceId() != null && Objects.equals(job.getTtsVoiceId(), past.getTtsVoiceId())) {
                add(sameVoice, sample);
            }
            if (provider) {
                add(sameProvider, sample);
            }
            add(anyVoice, sample);
        }
        for (long[] tier : List.of(sameVoice, sameProvider, anyVoice)) {
            if (tier[1] >= MIN_EVIDENCE_MS) {
                double cps = tier[0] * 1000.0 / tier[1];
                return Math.max(MIN_CPS, Math.min(MAX_CPS, Math.round(cps * 100.0) / 100.0));
            }
        }
        return null;
    }

    /** {characters, milliseconds} actually synthesized by the job's current TTS output. */
    private long[] measuredSpeech(MediaJob past) {
        MediaJobStage tts = stageRepository.findByMediaJobIdAndStageName(past.getId(), MediaJobStage.StageName.TTS)
                .orElse(null);
        if (tts == null || tts.getStatus() != MediaJobStage.StageStatus.COMPLETED || tts.getOutputRef() == null) {
            return new long[2];
        }
        Map<String, Long> durations = new HashMap<>();
        try {
            for (JsonNode item : objectMapper.readTree(tts.getOutputRef()).path("segments")) {
                long ms = item.path("duration_ms").asLong(0L);
                if (ms > 0L) {
                    durations.put(item.path("segment_id").asText(), ms);
                }
            }
        } catch (Exception ignored) {
            return new long[2];
        }
        long chars = 0L;
        long ms = 0L;
        for (SubtitleSegment row : subtitleSegmentRepository.findByMediaJobIdOrderBySeq(past.getId())) {
            Long duration = durations.get(row.getId().toString());
            if (duration != null && row.getTargetText() != null && !row.getTargetText().isBlank()) {
                chars += row.getTargetText().strip().length();
                ms += duration;
            }
        }
        return new long[] {chars, ms};
    }

    private static void add(long[] total, long[] sample) {
        total[0] += sample[0];
        total[1] += sample[1];
    }
}
