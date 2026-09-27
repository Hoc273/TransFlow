package com.app.modules.glossary.dto;

import com.app.modules.glossary.entity.GlossaryTerm;

import java.util.UUID;

public record GlossaryTermResponse(UUID id, UUID glossaryId, String sourceTerm, String targetTerm, String targetLang) {
    public static GlossaryTermResponse from(GlossaryTerm t) {
        return new GlossaryTermResponse(t.getId(), t.getGlossaryId(), t.getSourceTerm(), t.getTargetTerm(), t.getTargetLang());
    }
}
