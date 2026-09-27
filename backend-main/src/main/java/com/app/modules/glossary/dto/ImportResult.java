package com.app.modules.glossary.dto;

import java.util.List;

/** Result of {@code POST .../glossary/terms/import} (API_Contract.md §7). */
public record ImportResult(int imported, int skipped, List<String> errors) {
}
