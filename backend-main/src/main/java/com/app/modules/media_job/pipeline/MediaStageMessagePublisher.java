package com.app.modules.media_job.pipeline;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Publishes only after the DB transaction commits, preventing stale stage inputs. */
@Component
public class MediaStageMessagePublisher {

    private static final Logger log = LoggerFactory.getLogger(MediaStageMessagePublisher.class);
    private final RabbitTemplate rabbitTemplate;

    public MediaStageMessagePublisher(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    public void publish(MediaStageMessage message) {
        Runnable send = () -> {
            String route = MediaPipelineRabbitConfig.queueName(
                    com.app.modules.media_job.entity.MediaJobStage.StageName.valueOf(message.stageName()));
            log.info("Publishing media stage job={} stage={} attempt={}",
                    message.jobId(), message.stageName(), message.attemptCount());
            rabbitTemplate.convertAndSend(MediaPipelineRabbitConfig.EXCHANGE, route, message);
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send.run();
                }
            });
        } else {
            send.run();
        }
    }
}
