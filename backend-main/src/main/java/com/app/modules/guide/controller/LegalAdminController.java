package com.app.modules.guide.controller;

import com.app.common.dto.ApiResponse;
import com.app.common.security.AuthenticatedUser;
import com.app.modules.guide.dto.LegalDocumentDto;
import com.app.modules.guide.dto.LegalDocumentRequest;
import com.app.modules.guide.entity.LegalDocumentType;
import com.app.modules.guide.service.LegalDocumentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/platform/legal")
@RequiredArgsConstructor
public class LegalAdminController {

    private final LegalDocumentService legalDocumentService;

    @GetMapping
    public ApiResponse<List<LegalDocumentDto>> list(@AuthenticationPrincipal AuthenticatedUser user) {
        return ApiResponse.<List<LegalDocumentDto>>builder()
                .data(legalDocumentService.listAdmin(user.id()))
                .build();
    }

    @PutMapping("/{type}")
    public ApiResponse<LegalDocumentDto> update(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable String type,
            @Valid @RequestBody LegalDocumentRequest request) {
        return ApiResponse.<LegalDocumentDto>builder()
                .data(legalDocumentService.update(user.id(), LegalDocumentType.fromPath(type), request))
                .build();
    }
}
