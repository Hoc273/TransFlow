package com.app.modules.preset.service;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Optional;
import java.util.UUID;

/**
 * Interface provided by Member A for Member B to resolve media presets
 * (hierarchy: explicit -> project default -> workspace default -> system default)
 * for job snapshot creation.
 * See CLAUDE_A.md §8.4 and Backend_Java_TaskSplit_MemberA.md §4.
 */
public interface PresetResolverService {

    UUID resolveForJobCreation(UUID explicitPresetId, UUID projectId, UUID workspaceId);

    /** Config of an already-resolved preset, frozen by the caller into {@code media_jobs.preset_snapshot}. */
    Optional<PresetJobConfig> findJobConfig(UUID presetId);

    record PresetJobConfig(UUID presetId, String name, JsonNode subtitleStyle,
                           JsonNode voiceConfig, JsonNode renderConfig) {
    }
}
