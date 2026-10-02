package com.app.modules.platform.service;

import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.UserActivityLogItem;
import jakarta.servlet.http.HttpServletRequest;

import java.util.UUID;

/** Activity log of regular users (see {@code UserActivityLogFilter}). */
public interface UserActivityLogService {

    /** Own transaction; never throws to the caller. */
    void record(UUID userId, HttpServletRequest request, int statusCode);

    /** Super Admin only. All filters optional. */
    PlatformPageResponse<UserActivityLogItem> list(UUID callerId, UUID userId, UUID workspaceId, String q,
                                                   boolean failedOnly, Integer page, Integer size);
}
