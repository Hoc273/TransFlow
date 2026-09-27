package com.app.modules.guide.controller;

import com.app.common.dto.ApiResponse;
import com.app.modules.guide.dto.LegalDocumentDto;
import com.app.modules.guide.entity.LegalDocumentType;
import com.app.modules.guide.service.LegalDocumentService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Public Terms of Service / Privacy Policy (no auth), shown under the Guide page. */
@RestController
@RequestMapping("/api/legal")
@RequiredArgsConstructor
public class LegalPublicController {

    private final LegalDocumentService legalDocumentService;

    @GetMapping("/{type}")
    public ApiResponse<LegalDocumentDto> get(
            @PathVariable String type,
            @RequestParam(defaultValue = "vi") String lang) {
        return ApiResponse.<LegalDocumentDto>builder()
                .data(legalDocumentService.getPublished(LegalDocumentType.fromPath(type), lang))
                .build();
    }
}
