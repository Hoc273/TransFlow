package com.app.modules.media_job.dto.render;

import java.util.List;

/** {@code GET/PUT .../render-config} response; unset values are filled with defaults, never null (except colors). */
public record RenderConfigResponse(
        String subtitleMode,
        String subtitlePosition,
        int verticalOffsetPercent,
        boolean backgroundBox,
        String backgroundColor,
        String textColor,
        String outputAspectRatio,
        boolean confirmed,
        String sourceVideoUrl,
        int sourceVideoUrlExpiresInSeconds,
        RenderPresentation presentation,
        Effective effective) {

    /** Backend projection computed from stored data only (not persisted). */
    public record Effective(boolean boxMode, boolean ownedByStyle, int resolvedLinePercent, List<String> deadControls) {
    }
}
