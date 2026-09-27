package com.app.modules.guide.dto;

import com.app.modules.guide.entity.LegalDocument;
import com.app.modules.guide.entity.LegalDocumentType;

import java.time.Instant;

/**
 * {@code title}/{@code content} are resolved for the requested language (vi/en,
 * blank English falls back to Vietnamese); the per-language fields feed the admin editor.
 */
public record LegalDocumentDto(
        LegalDocumentType type,
        String title,
        String content,
        String titleVi,
        String titleEn,
        String contentVi,
        String contentEn,
        Instant updatedAt
) {
    public static LegalDocumentDto of(LegalDocument d, String lang) {
        boolean isEn = "en".equalsIgnoreCase(lang);
        String title = isEn && d.getTitleEn() != null && !d.getTitleEn().isBlank() ? d.getTitleEn() : d.getTitleVi();
        String content = isEn && d.getContentEn() != null && !d.getContentEn().isBlank() ? d.getContentEn() : d.getContentVi();
        return new LegalDocumentDto(
                d.getDocType(),
                title,
                content,
                d.getTitleVi(),
                d.getTitleEn(),
                d.getContentVi(),
                d.getContentEn(),
                d.getUpdatedAt()
        );
    }

    /** Public view: only the resolved language. */
    public static LegalDocumentDto publicOf(LegalDocument d, String lang) {
        LegalDocumentDto full = of(d, lang);
        return new LegalDocumentDto(full.type(), full.title(), full.content(), null, null, null, null, full.updatedAt());
    }
}
