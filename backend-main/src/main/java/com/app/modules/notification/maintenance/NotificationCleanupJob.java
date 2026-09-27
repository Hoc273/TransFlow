package com.app.modules.notification.maintenance;

import com.app.modules.notification.repository.NotificationRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;

/** Weekly notification retention: read ones after 30 days, every one after 90 days. */
@Component
public class NotificationCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(NotificationCleanupJob.class);

    private final NotificationRepository repository;
    private final boolean enabled;
    private final Duration readRetention;
    private final Duration maxRetention;

    public NotificationCleanupJob(NotificationRepository repository,
                                  @Value("${app.maintenance.enabled:true}") boolean enabled,
                                  @Value("${app.maintenance.notification-read-retention:P30D}") Duration readRetention,
                                  @Value("${app.maintenance.notification-max-retention:P90D}") Duration maxRetention) {
        this.repository = repository;
        this.enabled = enabled;
        this.readRetention = readRetention;
        this.maxRetention = maxRetention;
    }

    @Scheduled(cron = "${app.maintenance.notification-cleanup-cron:0 30 3 * * SUN}")
    @Transactional
    public void cleanup() {
        if (!enabled) {
            return;
        }
        Instant now = Instant.now();
        int deleted = repository.deleteExpired(now.minus(readRetention), now.minus(maxRetention));
        if (deleted > 0) {
            log.info("Notification cleanup removed {} row(s)", deleted);
        }
    }
}
