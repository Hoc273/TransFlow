package com.app.modules.platform.service;

import com.app.modules.platform.dto.PlatformPageResponse;
import com.app.modules.platform.dto.PlatformUserItem;
import com.app.modules.platform.dto.PlatformWorkspaceItem;

import java.util.UUID;

/**
 * Super Admin directory — users & workspaces metadata only (API_Contract.md §13.1).
 * Never returns password_hash, google_sub, keys, or content.
 */
public interface PlatformDirectoryService {

    PlatformPageResponse<PlatformUserItem> listUsers(UUID callerId, String q,
                                                   Boolean isPlatformAdmin,
                                                   Integer page, Integer size);

    PlatformPageResponse<PlatformWorkspaceItem> listWorkspaces(UUID callerId, String q,
                                                             Integer page, Integer size);
}
