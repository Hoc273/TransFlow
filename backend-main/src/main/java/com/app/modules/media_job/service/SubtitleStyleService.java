package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.style.SubtitleStylePreset;
import com.app.modules.media_job.dto.style.SubtitleStyleSnapshot;

import java.util.List;
import java.util.UUID;

/** Built-in subtitle style catalog + the style snapshot assigned to a job (API_Contract.md §5). */
public interface SubtitleStyleService {

    List<SubtitleStylePreset> listPresets();

    /** @throws com.app.common.exception.AppException INVALID_STYLE_KEY (malformed) / STYLE_NOT_FOUND (unknown) */
    SubtitleStylePreset getPreset(String key);

    /** Snapshot assigned to the job; STYLE_NOT_FOUND when none. Any role in the job's project may read. */
    SubtitleStyleSnapshot currentStyle(UUID userId, UUID jobId);

    /** Overwrites the job's snapshot (LEAD / owning MEMBER); a COMPLETED RENDER stage becomes STALE if it changed. */
    SubtitleStyleSnapshot assignStyle(UUID userId, UUID jobId, String key);
}
