package com.app.modules.platform.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.platform.service.UserPresenceService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Presence heartbeat — called by the frontend every ~60s while a user is
 * logged in. Any authenticated user may call it; the aggregated online count
 * is exposed to Super Admins via {@code GET /api/platform/realtime}.
 */
@RestController
@RequestMapping("/api/presence")
public class PresenceController {

    private final UserPresenceService presenceService;

    public PresenceController(UserPresenceService presenceService) {
        this.presenceService = presenceService;
    }

    @PostMapping("/heartbeat")
    public ApiResponse<Map<String, Boolean>> heartbeat(@AuthenticationPrincipal AuthenticatedUser user) {
        presenceService.heartbeat(user.id());
        return ApiResponse.<Map<String, Boolean>>builder()
                .data(Map.of("recorded", true))
                .build();
    }
}
