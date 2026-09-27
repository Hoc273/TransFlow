package com.app.modules.media_job.service;

import com.app.modules.media_job.dto.render.RenderConfigResponse;
import com.app.modules.media_job.dto.render.UpdateRenderConfigRequest;
import com.app.modules.media_job.entity.MediaJob;

import java.util.UUID;

/** Render Studio config of a media job (API_Contract.md §5 {@code render-config}, {@code rerun-render}). */
public interface MediaRenderConfigService {

    RenderConfigResponse get(UUID workspaceId, UUID userId, UUID jobId);

    /** Partial update (null field = keep); marks a COMPLETED RENDER stage STALE. */
    RenderConfigResponse update(UUID workspaceId, UUID userId, UUID jobId, UpdateRenderConfigRequest request);

    /** Saves {@code request} when non-null, then re-runs from the RENDER stage. */
    MediaJob rerunRender(UUID workspaceId, UUID userId, UUID jobId, UpdateRenderConfigRequest request);
}
