package com.app.modules.platform.service;

import com.app.modules.platform.dto.PlatformAuditLogItem;
import com.app.modules.platform.dto.PlatformPageResponse;

import java.util.UUID;

/** Self-read of Super Admin audit logs (API_Contract.md §13.1). */
public interface PlatformAuditQueryService {

    PlatformPageResponse<PlatformAuditLogItem> list(UUID callerId, String action,
                                                  Integer page, Integer size);
}
