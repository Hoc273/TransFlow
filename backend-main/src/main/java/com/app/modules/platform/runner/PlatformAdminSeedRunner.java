package com.app.modules.platform.runner;

import com.app.common.config.AppProperties;
import com.app.modules.auth.service.AuthService;
import com.app.modules.platform.service.PlatformAdminAuditService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * Idempotent bootstrap of {@code users.is_platform_admin} from env allowlist
 * (SRS §5.8). Only grants; never auto-creates users; never revokes.
 * The actual write goes through {@code AuthService} — platform does not write
 * the auth module's table directly (CLAUDE.md §4.8 boundary).
 */
@Component
@Order(100)
public class PlatformAdminSeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PlatformAdminSeedRunner.class);

    private final AppProperties props;
    private final AuthService authService;
    private final PlatformAdminAuditService auditService;

    public PlatformAdminSeedRunner(AppProperties props,
                                   AuthService authService,
                                   PlatformAdminAuditService auditService) {
        this.props = props;
        this.authService = authService;
        this.auditService = auditService;
    }

    @Override
    public void run(ApplicationArguments args) {
        AppProperties.PlatformAdmin cfg = props.platformAdmin();
        if (cfg == null || !cfg.seedOnStartup()) {
            log.debug("platform_admin_seed skipped (seed-on-startup=false or unset)");
            return;
        }
        String raw = cfg.emails();
        if (raw == null || raw.isBlank()) {
            log.debug("platform_admin_seed skipped (PLATFORM_ADMIN_EMAILS empty)");
            return;
        }

        Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .forEach(this::grantIfPresent);
    }

    private void grantIfPresent(String email) {
        var outcome = authService.grantPlatformAdminByEmail(email);
        switch (outcome.result()) {
            case USER_NOT_FOUND -> log.warn("platform_admin_seed_missing_user email={}", email);
            case ALREADY_ADMIN -> log.debug("platform_admin_seed already granted email={}", email);
            case GRANTED -> {
                auditService.seedGrant(outcome.userId());
                log.info("platform_admin_seed granted email={} userId={}", email, outcome.userId());
            }
        }
    }
}
