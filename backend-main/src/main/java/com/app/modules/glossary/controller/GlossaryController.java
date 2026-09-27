package com.app.modules.glossary.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.glossary.dto.GlossaryResponse;
import com.app.modules.glossary.dto.GlossaryTermRequest;
import com.app.modules.glossary.dto.GlossaryTermResponse;
import com.app.modules.glossary.dto.ImportResult;
import com.app.modules.glossary.service.GlossaryService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

/** Glossary — 1 table of terms per Project (API_Contract.md §7). */
@RestController
@RequestMapping("/api/workspaces/{workspaceId}/projects/{projectId}/glossary")
public class GlossaryController {

    private final GlossaryService glossaryService;

    public GlossaryController(GlossaryService glossaryService) {
        this.glossaryService = glossaryService;
    }

    @GetMapping
    public ApiResponse<GlossaryResponse> getGlossary(@AuthenticationPrincipal AuthenticatedUser user,
                                                        @PathVariable UUID workspaceId,
                                                        @PathVariable UUID projectId) {
        var glossary = glossaryService.getOrCreateGlossary(workspaceId, user.id(), projectId);
        return ApiResponse.<GlossaryResponse>builder().data(GlossaryResponse.from(glossary)).build();
    }

    @GetMapping("/terms")
    public ApiResponse<List<GlossaryTermResponse>> listTerms(@AuthenticationPrincipal AuthenticatedUser user,
                                                                @PathVariable UUID workspaceId,
                                                                @PathVariable UUID projectId) {
        var terms = glossaryService.listTerms(workspaceId, user.id(), projectId).stream()
                .map(GlossaryTermResponse::from)
                .toList();
        return ApiResponse.<List<GlossaryTermResponse>>builder().data(terms).build();
    }

    @PostMapping("/terms")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<GlossaryTermResponse> createTerm(@AuthenticationPrincipal AuthenticatedUser user,
                                                           @PathVariable UUID workspaceId,
                                                           @PathVariable UUID projectId,
                                                           @Valid @RequestBody GlossaryTermRequest request) {
        var term = glossaryService.createTerm(workspaceId, user.id(), projectId,
                request.sourceTerm(), request.targetTerm(), request.targetLang());
        return ApiResponse.<GlossaryTermResponse>builder().data(GlossaryTermResponse.from(term)).build();
    }

    @PutMapping("/terms/{termId}")
    public ApiResponse<GlossaryTermResponse> updateTerm(@AuthenticationPrincipal AuthenticatedUser user,
                                                           @PathVariable UUID workspaceId,
                                                           @PathVariable UUID projectId,
                                                           @PathVariable UUID termId,
                                                           @Valid @RequestBody GlossaryTermRequest request) {
        var term = glossaryService.updateTerm(workspaceId, user.id(), projectId, termId,
                request.sourceTerm(), request.targetTerm(), request.targetLang());
        return ApiResponse.<GlossaryTermResponse>builder().data(GlossaryTermResponse.from(term)).build();
    }

    @DeleteMapping("/terms/{termId}")
    public ApiResponse<Void> deleteTerm(@AuthenticationPrincipal AuthenticatedUser user,
                                         @PathVariable UUID workspaceId,
                                         @PathVariable UUID projectId,
                                         @PathVariable UUID termId) {
        glossaryService.deleteTerm(workspaceId, user.id(), projectId, termId);
        return ApiResponse.<Void>builder().build();
    }

    @PostMapping(value = "/terms/import", consumes = "multipart/form-data")
    public ApiResponse<ImportResult> importTerms(@AuthenticationPrincipal AuthenticatedUser user,
                                                  @PathVariable UUID workspaceId,
                                                  @PathVariable UUID projectId,
                                                  @RequestParam("file") MultipartFile file) {
        ImportResult result = glossaryService.importCsv(workspaceId, user.id(), projectId, file);
        return ApiResponse.<ImportResult>builder().data(result).build();
    }
}
