package com.app.modules.media_job.dto.render;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Render Studio presentation envelope (subtitle cover layers + audio mix); replaced as a whole when sent. */
public record RenderPresentation(@Valid Subtitle subtitle, @Valid Audio audio) {

    public static final int MAX_LAYERS = 4; // backend-media-worker rejects more than 4 layers (max_length=4)

    /** {@code wordsPerPhrase} applies to PHRASE only (render groups cues by it; absent = 5 words). */
    public record Subtitle(
            @Pattern(regexp = "SENTENCE|PHRASE|WORD") String displayMode,
            @Min(3) @Max(10) Integer wordsPerPhrase,
            @Valid @Size(max = MAX_LAYERS) List<Layer> layers) {
    }

    public record Layer(
            @NotNull @Pattern(regexp = "COVER_BOX|IMAGE|WATERMARK") String layerType,
            @Pattern(regexp = "SUBTITLE|TOP|CENTER|BOTTOM") String anchor,
            @NotNull @DecimalMin("0") @DecimalMax("100") Double xPercent,
            @NotNull @DecimalMin("0") @DecimalMax("100") Double yPercent,
            @NotNull @DecimalMin("20") @DecimalMax("100") Double widthPercent,
            @NotNull @DecimalMin("5") @DecimalMax("50") Double heightPercent,
            @Pattern(regexp = "^#[0-9A-Fa-f]{6}$") String colorHex,
            @DecimalMin("0") @DecimalMax("1") Double opacity) {
    }

    public record Audio(
            @DecimalMin("-30") @DecimalMax("12") Double originalGainDb,
            @DecimalMin("-30") @DecimalMax("12") Double ttsGainDb,
            @Valid Ducking ducking) {
    }

    public record Ducking(
            Boolean enabled,
            @DecimalMin("-30") @DecimalMax("0") Double gainDb,
            @Min(0) @Max(1000) Integer attackMs,
            @Min(0) @Max(2000) Integer releaseMs) {
    }
}
