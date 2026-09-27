package com.app.modules.media_job.pipeline;

import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.entity.SubtitleSegment;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.app.modules.media_job.repository.SubtitleSegmentRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NarrationPacingEstimatorTest {

    @Mock private MediaJobRepository jobRepository;
    @Mock private MediaJobStageRepository stageRepository;
    @Mock private SubtitleSegmentRepository subtitleSegmentRepository;

    private final UUID userId = UUID.randomUUID();
    private final UUID provider = UUID.randomUUID();
    private final UUID voice = UUID.randomUUID();

    private MediaJob job(UUID providerId, UUID voiceId) {
        MediaJob job = new MediaJob();
        job.setId(UUID.randomUUID());
        job.setCreatedByUserId(userId);
        job.setTargetLang("vi");
        job.setTtsProviderId(providerId);
        job.setTtsVoiceId(voiceId);
        return job;
    }

    /** A finished job whose TTS read {@code clips} clips of {@code chars} characters in {@code ms} each. */
    private MediaJob history(UUID providerId, UUID voiceId, int clips, int chars, long ms,
                             MediaJobStage.StageStatus ttsStatus) {
        MediaJob past = job(providerId, voiceId);
        List<SubtitleSegment> rows = new ArrayList<>();
        StringBuilder output = new StringBuilder("{\"segments\":[");
        for (int i = 0; i < clips; i++) {
            SubtitleSegment row = new SubtitleSegment();
            row.setId(UUID.randomUUID());
            row.setTargetText("x".repeat(chars));
            rows.add(row);
            output.append(i == 0 ? "" : ",")
                    .append("{\"segment_id\":\"").append(row.getId()).append("\",\"duration_ms\":").append(ms).append('}');
        }
        MediaJobStage tts = new MediaJobStage();
        tts.setStatus(ttsStatus);
        tts.setOutputRef(output.append("]}").toString());
        when(stageRepository.findByMediaJobIdAndStageName(past.getId(), MediaJobStage.StageName.TTS))
                .thenReturn(Optional.of(tts));
        when(subtitleSegmentRepository.findByMediaJobIdOrderBySeq(past.getId())).thenReturn(rows);
        return past;
    }

    private NarrationPacingEstimator estimator() {
        return new NarrationPacingEstimator(jobRepository, stageRepository, subtitleSegmentRepository);
    }

    @Test
    void sameVoiceHistoryWinsOverOtherVoices() {
        MediaJob current = job(provider, voice);
        MediaJob sameVoice = history(provider, voice, 10, 174, 10_000L, MediaJobStage.StageStatus.COMPLETED);
        MediaJob otherVoice = history(provider, UUID.randomUUID(), 10, 120, 10_000L, MediaJobStage.StageStatus.COMPLETED);
        when(jobRepository.findTop20ByCreatedByUserIdAndTargetLangAndIdNotOrderByCreatedAtDesc(userId, "vi", current.getId()))
                .thenReturn(List.of(otherVoice, sameVoice));

        assertEquals(17.4, estimator().estimateCps(current), 0.01);
    }

    @Test
    void fallsBackToTheLanguageHistoryWhenTheVoiceIsNew() {
        MediaJob current = job(provider, voice);
        MediaJob anyVoice = history(UUID.randomUUID(), UUID.randomUUID(), 10, 150, 10_000L, MediaJobStage.StageStatus.COMPLETED);
        when(jobRepository.findTop20ByCreatedByUserIdAndTargetLangAndIdNotOrderByCreatedAtDesc(userId, "vi", current.getId()))
                .thenReturn(List.of(anyVoice));

        assertEquals(15.0, estimator().estimateCps(current), 0.01);
    }

    @Test
    void ignoresTooLittleOrStaleEvidence() {
        MediaJob current = job(provider, voice);
        MediaJob tiny = history(provider, voice, 2, 174, 10_000L, MediaJobStage.StageStatus.COMPLETED);
        MediaJob stale = history(provider, voice, 10, 300, 10_000L, MediaJobStage.StageStatus.STALE);
        when(jobRepository.findTop20ByCreatedByUserIdAndTargetLangAndIdNotOrderByCreatedAtDesc(userId, "vi", current.getId()))
                .thenReturn(List.of(tiny, stale));

        assertNull(estimator().estimateCps(current), "the gateway default applies without enough measured speech");
    }
}
