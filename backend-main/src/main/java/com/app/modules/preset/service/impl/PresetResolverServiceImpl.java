package com.app.modules.preset.service.impl;

import com.app.modules.preset.service.PresetResolverService;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Placeholder implementation pending Member A's full preset module
 * (Backend_Java_TaskSplit_MemberB.md §4 — mock permitted while A's module is unfinished).
 * Resolution hierarchy (explicit > project default > workspace default > system default)
 * is Member A's to implement; for now only the explicit presetId passes through so
 * media_job can freeze {@code media_jobs.preset_snapshot} without blocking on this module.
 */
@Service
public class PresetResolverServiceImpl implements PresetResolverService {

    @Override
    public UUID resolveForJobCreation(UUID explicitPresetId, UUID projectId, UUID workspaceId) {
        return explicitPresetId;
    }
}
