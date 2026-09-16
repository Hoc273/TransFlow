package com.app.modules.glossary.service;

import com.app.modules.glossary.dto.ImportResult;
import com.app.modules.glossary.entity.Glossary;
import com.app.modules.glossary.entity.GlossaryTerm;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

/**
 * Glossary — 1 table of terms per Project (API_Contract.md §7, Database_Design.md §8.2,
 * Backend_Java_TaskSplit_MemberB.md §2.5). No Translation Memory anywhere in transflow_mini.
 */
public interface GlossaryService {

    /** Returns the Project's glossary, creating an empty one on first access. */
    Glossary getOrCreateGlossary(UUID workspaceId, UUID userId, UUID projectId);

    List<GlossaryTerm> listTerms(UUID workspaceId, UUID userId, UUID projectId);

    GlossaryTerm createTerm(UUID workspaceId, UUID userId, UUID projectId, String sourceTerm, String targetTerm, String targetLang);

    GlossaryTerm updateTerm(UUID workspaceId, UUID userId, UUID projectId, UUID termId,
                             String sourceTerm, String targetTerm, String targetLang);

    void deleteTerm(UUID workspaceId, UUID userId, UUID projectId, UUID termId);

    /** CSV import — header {@code source_term,target_term,target_lang}; invalid rows are skipped and reported. */
    ImportResult importCsv(UUID workspaceId, UUID userId, UUID projectId, MultipartFile file);
}
