package com.app.modules.preset.service;

import java.util.UUID;

/**
 * Interface provided by Member A for Member B to resolve media presets
 * (hierarchy: explicit -> project default -> workspace default -> system default)
 * for job snapshot creation.
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface PresetResolverService {

    UUID resolveForJobCreation(UUID explicitPresetId, UUID projectId, UUID workspaceId);
}
