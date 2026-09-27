package com.app.modules.media_job.pipeline;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Sole RabbitMQ consumer for media.stage.*. */
@Component
@ConditionalOnProperty(name = "app.pipeline.enabled", havingValue = "true", matchIfMissing = true)
public class MediaStageProcessListener {

    private final MediaStageExecutionService executionService;

    public MediaStageProcessListener(MediaStageExecutionService executionService) {
        this.executionService = executionService;
    }

    @RabbitListener(
            queues = {
                    "media.stage.EXTRACT_AUDIO", "media.stage.SOURCE_SEPARATION", "media.stage.STT",
                    "media.stage.SUMMARIZE", "media.stage.TRANSLATE", "media.stage.TTS",
                    "media.stage.AUDIO_MIX", "media.stage.RENDER"
            },
            containerFactory = "mediaStageListenerContainerFactory")
    public void onMessage(MediaStageMessage message) {
        executionService.execute(message);
    }
}
