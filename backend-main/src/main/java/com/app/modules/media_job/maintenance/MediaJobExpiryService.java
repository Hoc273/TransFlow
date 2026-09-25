package com.app.modules.media_job.maintenance;

import com.app.common.exception.AiStageException;
import com.app.modules.media_job.callback.service.MediaCallbackService;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.entity.MediaJobStage;
import com.app.modules.media_job.repository.MediaJobRepository;
import com.app.modules.media_job.repository.MediaJobStageRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Fails an open job whose source video no longer exists in storage (retention). */
@Service
public class MediaJobExpiryService {

    public static final String MEDIA_FILE_EXPIRED = "MEDIA_FILE_EXPIRED";

    private final MediaJobRepository jobRepository;
    private final MediaJobStageRepository stageRepository;
    private final MediaCallbackService callbackService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MediaJobExpiryService(MediaJobRepository jobRepository,
                                 MediaJobStageRepository stageRepository,
                                 MediaCallbackService callbackService) {
        this.jobRepository = jobRepository;
        this.stageRepository = stageRepository;
        this.callbackService = callbackService;
    }

    /**
     * Fails the first unfinished stage with {@code MEDIA_FILE_EXPIRED} (which fails the job and
     * notifies its owner through the regular stage-completion path).
     *
     * @return false when the job is already finished or a stage is still running
     */
    @Transactional
    public boolean expire(UUID jobId) {
        Optional<MediaJob> locked = jobRepository.findWithLockById(jobId);
        if (locked.isEmpty()) {
            return false;
        }
        MediaJob job = locked.get();
        if (job.getStatus() != MediaJob.JobStatus.PENDING && job.getStatus() != MediaJob.JobStatus.PROCESSING) {
            return false;
        }
        List<MediaJobStage> stages = stageRepository.findByMediaJobIdOrderByStageOrder(jobId);
        boolean running = stages.stream().anyMatch(s -> s.getStatus() == MediaJobStage.StageStatus.PROCESSING
                || s.getStatus() == MediaJobStage.StageStatus.CANCEL_REQUESTED);
        if (running) {
            return false;
        }
        Optional<MediaJobStage> target = stages.stream()
                .filter(s -> s.getStatus() == MediaJobStage.StageStatus.PENDING
                        || s.getStatus() == MediaJobStage.StageStatus.STALE)
                .findFirst();
        if (target.isEmpty()) {
            return false;
        }
        String message = "Source media was deleted after the retention period";
        AiStageException expired = AiStageException.safeFailure(MEDIA_FILE_EXPIRED, message, false,
                "Upload the video again and create a new job.", null, null);
        MediaJobStage stage = target.get();
        callbackService.completeStage(jobId, stage.getId(), stage.getStageName(), false, null, message,
                expired.getErrorCode(), objectMapper.valueToTree(expired.getErrorDetail()));
        return true;
    }
}
