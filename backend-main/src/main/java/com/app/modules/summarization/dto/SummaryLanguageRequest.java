package com.app.modules.summarization.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.UUID;

/** {@code POST .../summary-languages} body (API_Contract.md §5.1, Arch §7.7). */
public record SummaryLanguageRequest(@NotBlank String targetLang, UUID ttsVoiceId) {
}
