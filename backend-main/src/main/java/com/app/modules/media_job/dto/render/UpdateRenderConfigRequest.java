package com.app.modules.media_job.dto.render;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;

/**
 * {@code PUT .../render-config} body (API_Contract.md §5); null field = keep stored value.
 * Also the persisted shape of {@code media_jobs.render_config} (already merged, so stored nulls mean "unset").
 * ponytail: colors/aspect can't be cleared back to unset, only replaced; add tri-state if FE needs it.
 */
public record UpdateRenderConfigRequest(
        @Pattern(regexp = "HARD_SUB|SOFT_SUB") String subtitleMode,
        @Pattern(regexp = "TOP|CENTER|BOTTOM") String subtitlePosition,
        @Min(-30) @Max(30) Integer verticalOffsetPercent,
        Boolean backgroundBox,
        @Pattern(regexp = "^#[0-9A-Fa-f]{8}$") String backgroundColor,
        @Pattern(regexp = "^#[0-9A-Fa-f]{6}$") String textColor,
        @Pattern(regexp = "ORIGINAL|16:9|9:16|1:1|4:3") String outputAspectRatio,
        @Valid RenderPresentation presentation) {

    /** Field-wise overlay: values in {@code patch} win, nulls fall back to this (stored) config. */
    public UpdateRenderConfigRequest merge(UpdateRenderConfigRequest patch) {
        return new UpdateRenderConfigRequest(
                pick(patch.subtitleMode, subtitleMode),
                pick(patch.subtitlePosition, subtitlePosition),
                pick(patch.verticalOffsetPercent, verticalOffsetPercent),
                pick(patch.backgroundBox, backgroundBox),
                pick(patch.backgroundColor, backgroundColor),
                pick(patch.textColor, textColor),
                pick(patch.outputAspectRatio, outputAspectRatio),
                pick(patch.presentation, presentation));
    }

    private static <T> T pick(T patch, T stored) {
        return patch != null ? patch : stored;
    }
}
