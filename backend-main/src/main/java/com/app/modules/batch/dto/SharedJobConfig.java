package com.app.modules.batch.dto;

import java.util.UUID;

/**
 * Fields shared by every child job of a batch (API_Contract.md §6 — "sharedConfig:{...cùng field job
 * Localization}"). Batch is Localization-only (SRS §5.4) — no {@code requestedDurationSeconds}/
 * {@code visualContextEnabled}, those are Summarization-only fields.
 */
public record SharedJobConfig(
        String processingMode,
        String subtitleMode,
        String outputAudioMode,
        Boolean sourceSeparationEnabled,
        UUID ttsVoiceId,
        String workflowMode,
        UUID presetId
) {
}
