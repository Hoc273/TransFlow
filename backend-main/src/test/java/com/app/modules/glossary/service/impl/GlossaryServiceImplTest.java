package com.app.modules.glossary.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.glossary.dto.ImportResult;
import com.app.modules.glossary.entity.Glossary;
import com.app.modules.glossary.entity.GlossaryTerm;
import com.app.modules.glossary.repository.GlossaryRepository;
import com.app.modules.glossary.repository.GlossaryTermRepository;
import com.app.modules.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GlossaryServiceImplTest {

    @Mock private GlossaryRepository glossaryRepository;
    @Mock private GlossaryTermRepository glossaryTermRepository;
    @Mock private WorkspaceAccessService access;

    private GlossaryServiceImpl service;

    private final UUID workspaceId = UUID.randomUUID();
    private final UUID projectId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new GlossaryServiceImpl(glossaryRepository, glossaryTermRepository, access);
    }

    private Glossary existingGlossary() {
        Glossary g = new Glossary();
        g.setId(UUID.randomUUID());
        g.setProjectId(projectId);
        return g;
    }

    // ---- getOrCreateGlossary ----

    @Test
    void getOrCreateGlossary_alreadyExists_returnsExisting() {
        Glossary existing = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(existing));

        Glossary result = service.getOrCreateGlossary(workspaceId, userId, projectId);

        verify(access).requireProjectAccess(workspaceId, userId, projectId);
        assertSame(existing, result);
        verify(glossaryRepository, never()).save(any());
    }

    @Test
    void getOrCreateGlossary_missing_createsNew() {
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.empty());
        when(glossaryRepository.save(any(Glossary.class))).thenAnswer(inv -> {
            Glossary g = inv.getArgument(0);
            g.setId(UUID.randomUUID());
            return g;
        });

        Glossary result = service.getOrCreateGlossary(workspaceId, userId, projectId);

        assertEquals(projectId, result.getProjectId());
        assertNotNull(result.getCreatedAt());
    }

    // ---- createTerm / updateTerm / deleteTerm ----

    @Test
    void createTerm_success_savesUnderProjectGlossary() {
        Glossary glossary = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(glossary));
        when(glossaryTermRepository.save(any(GlossaryTerm.class))).thenAnswer(inv -> inv.getArgument(0));

        GlossaryTerm term = service.createTerm(workspaceId, userId, projectId, "hello", "xin chao", "vi");

        verify(access).requireProjectWriteAccess(workspaceId, userId, projectId);
        assertEquals(glossary.getId(), term.getGlossaryId());
        assertEquals("hello", term.getSourceTerm());
        assertEquals("xin chao", term.getTargetTerm());
        assertEquals("vi", term.getTargetLang());
    }

    @Test
    void updateTerm_notFound_throwsResourceNotFound() {
        Glossary glossary = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(glossary));
        UUID termId = UUID.randomUUID();
        when(glossaryTermRepository.findByIdAndGlossaryId(termId, glossary.getId())).thenReturn(Optional.empty());

        AppException ex = assertThrows(AppException.class, () ->
                service.updateTerm(workspaceId, userId, projectId, termId, "a", "b", "en"));
        assertEquals(ErrorCode.RESOURCE_NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void updateTerm_found_updatesFields() {
        Glossary glossary = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(glossary));
        GlossaryTerm existing = new GlossaryTerm();
        existing.setId(UUID.randomUUID());
        existing.setGlossaryId(glossary.getId());
        when(glossaryTermRepository.findByIdAndGlossaryId(existing.getId(), glossary.getId())).thenReturn(Optional.of(existing));
        when(glossaryTermRepository.save(any(GlossaryTerm.class))).thenAnswer(inv -> inv.getArgument(0));

        GlossaryTerm updated = service.updateTerm(workspaceId, userId, projectId, existing.getId(), "new-src", "new-tgt", "fr");

        assertEquals("new-src", updated.getSourceTerm());
        assertEquals("new-tgt", updated.getTargetTerm());
        assertEquals("fr", updated.getTargetLang());
    }

    @Test
    void deleteTerm_found_deletesIt() {
        Glossary glossary = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(glossary));
        GlossaryTerm existing = new GlossaryTerm();
        existing.setId(UUID.randomUUID());
        when(glossaryTermRepository.findByIdAndGlossaryId(existing.getId(), glossary.getId())).thenReturn(Optional.of(existing));

        service.deleteTerm(workspaceId, userId, projectId, existing.getId());

        verify(glossaryTermRepository).delete(existing);
    }

    // ---- importCsv ----

    @Test
    void importCsv_emptyFile_throwsValidationError() {
        MockMultipartFile file = new MockMultipartFile("file", "terms.csv", "text/csv", new byte[0]);

        AppException ex = assertThrows(AppException.class, () ->
                service.importCsv(workspaceId, userId, projectId, file));
        assertEquals(ErrorCode.VALIDATION_ERROR, ex.getErrorCode());
    }

    @Test
    void importCsv_withHeaderAndMixedRows_importsValidSkipsInvalid() {
        Glossary glossary = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(glossary));
        when(glossaryTermRepository.save(any(GlossaryTerm.class))).thenAnswer(inv -> inv.getArgument(0));

        String csv = "source_term,target_term,target_lang\n"
                + "hello,xin chao,vi\n"
                + "bad,row\n" // only 2 columns -> invalid
                + "world,the gioi,vi\n";
        MockMultipartFile file = new MockMultipartFile("file", "terms.csv", "text/csv", csv.getBytes());

        ImportResult result = service.importCsv(workspaceId, userId, projectId, file);

        assertEquals(2, result.imported());
        assertEquals(1, result.skipped());
        assertEquals(1, result.errors().size());
        verify(glossaryTermRepository, times(2)).save(any(GlossaryTerm.class));
    }

    @Test
    void importCsv_withoutHeader_treatsFirstLineAsData() {
        Glossary glossary = existingGlossary();
        when(glossaryRepository.findByProjectId(projectId)).thenReturn(Optional.of(glossary));
        when(glossaryTermRepository.save(any(GlossaryTerm.class))).thenAnswer(inv -> inv.getArgument(0));

        String csv = "hello,xin chao,vi\n";
        MockMultipartFile file = new MockMultipartFile("file", "terms.csv", "text/csv", csv.getBytes());

        ImportResult result = service.importCsv(workspaceId, userId, projectId, file);

        assertEquals(1, result.imported());
        assertEquals(0, result.skipped());
    }
}
