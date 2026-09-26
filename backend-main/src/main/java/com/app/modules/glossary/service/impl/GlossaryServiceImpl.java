package com.app.modules.glossary.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.glossary.dto.ImportResult;
import com.app.modules.glossary.entity.Glossary;
import com.app.modules.glossary.entity.GlossaryTerm;
import com.app.modules.glossary.repository.GlossaryRepository;
import com.app.modules.glossary.repository.GlossaryTermRepository;
import com.app.modules.glossary.service.GlossaryService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
public class GlossaryServiceImpl implements GlossaryService {

    static final long MAX_IMPORT_BYTES = 2L * 1024 * 1024;
    static final int MAX_IMPORT_ROWS = 10_000;
    static final int MAX_TERM_LENGTH = 500;
    static final int MAX_LANG_LENGTH = 16;

    private final GlossaryRepository glossaryRepository;
    private final GlossaryTermRepository glossaryTermRepository;
    private final WorkspaceAccessService access;

    public GlossaryServiceImpl(GlossaryRepository glossaryRepository,
                                GlossaryTermRepository glossaryTermRepository,
                                WorkspaceAccessService access) {
        this.glossaryRepository = glossaryRepository;
        this.glossaryTermRepository = glossaryTermRepository;
        this.access = access;
    }

    @Override
    @Transactional
    public Glossary getOrCreateGlossary(UUID workspaceId, UUID userId, UUID projectId) {
        access.requireProjectAccess(workspaceId, userId, projectId);
        return glossaryRepository.findByProjectId(projectId).orElseGet(() -> {
            Glossary glossary = new Glossary();
            glossary.setProjectId(projectId);
            glossary.setCreatedAt(Instant.now());
            return glossaryRepository.save(glossary);
        });
    }

    @Override
    @Transactional
    public List<GlossaryTerm> listTerms(UUID workspaceId, UUID userId, UUID projectId) {
        Glossary glossary = getOrCreateGlossary(workspaceId, userId, projectId);
        return glossaryTermRepository.findByGlossaryId(glossary.getId());
    }

    @Override
    @Transactional
    public GlossaryTerm createTerm(UUID workspaceId, UUID userId, UUID projectId,
                                    String sourceTerm, String targetTerm, String targetLang) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);
        Glossary glossary = getOrCreateGlossary(workspaceId, userId, projectId);

        GlossaryTerm term = new GlossaryTerm();
        term.setGlossaryId(glossary.getId());
        term.setSourceTerm(sourceTerm);
        term.setTargetTerm(targetTerm);
        term.setTargetLang(targetLang);
        return glossaryTermRepository.save(term);
    }

    @Override
    @Transactional
    public GlossaryTerm updateTerm(UUID workspaceId, UUID userId, UUID projectId, UUID termId,
                                    String sourceTerm, String targetTerm, String targetLang) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);
        Glossary glossary = getOrCreateGlossary(workspaceId, userId, projectId);
        GlossaryTerm term = glossaryTermRepository.findByIdAndGlossaryId(termId, glossary.getId())
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));

        term.setSourceTerm(sourceTerm);
        term.setTargetTerm(targetTerm);
        term.setTargetLang(targetLang);
        return glossaryTermRepository.save(term);
    }

    @Override
    @Transactional
    public void deleteTerm(UUID workspaceId, UUID userId, UUID projectId, UUID termId) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);
        Glossary glossary = getOrCreateGlossary(workspaceId, userId, projectId);
        GlossaryTerm term = glossaryTermRepository.findByIdAndGlossaryId(termId, glossary.getId())
                .orElseThrow(() -> new AppException(ErrorCode.RESOURCE_NOT_FOUND));
        glossaryTermRepository.delete(term);
    }

    @Override
    @Transactional
    public ImportResult importCsv(UUID workspaceId, UUID userId, UUID projectId, MultipartFile file) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);
        if (file == null || file.isEmpty()) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (file.getSize() > MAX_IMPORT_BYTES) {
            throw new AppException(ErrorCode.GLOSSARY_IMPORT_TOO_LARGE);
        }
        Glossary glossary = getOrCreateGlossary(workspaceId, userId, projectId);

        int imported = 0;
        int skipped = 0;
        List<String> errors = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            int lineNo = 0;
            boolean headerSkipped = false;
            while ((line = reader.readLine()) != null) {
                lineNo++;
                if (line.isBlank()) {
                    continue;
                }
                if (!headerSkipped && line.trim().equalsIgnoreCase("source_term,target_term,target_lang")) {
                    headerSkipped = true;
                    continue;
                }
                headerSkipped = true; // header is optional — only skip it once, at most, when present
                if (imported + skipped >= MAX_IMPORT_ROWS) {
                    throw new AppException(ErrorCode.GLOSSARY_IMPORT_TOO_LARGE);
                }

                String[] cols = line.split(",", -1);
                if (cols.length != 3 || cols[0].isBlank() || cols[1].isBlank() || cols[2].isBlank()
                        || cols[0].trim().length() > MAX_TERM_LENGTH || cols[1].trim().length() > MAX_TERM_LENGTH
                        || cols[2].trim().length() > MAX_LANG_LENGTH) {
                    skipped++;
                    errors.add("Line " + lineNo + ": expected source_term,target_term,target_lang");
                    continue;
                }
                GlossaryTerm term = new GlossaryTerm();
                term.setGlossaryId(glossary.getId());
                term.setSourceTerm(cols[0].trim());
                term.setTargetTerm(cols[1].trim());
                term.setTargetLang(cols[2].trim());
                glossaryTermRepository.save(term);
                imported++;
            }
        } catch (IOException e) {
            log.error("Failed to read glossary CSV: {}", e.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
        return new ImportResult(imported, skipped, errors);
    }
}
