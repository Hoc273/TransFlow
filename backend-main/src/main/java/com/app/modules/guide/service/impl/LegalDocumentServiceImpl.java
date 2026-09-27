package com.app.modules.guide.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.guide.dto.LegalDocumentDto;
import com.app.modules.guide.dto.LegalDocumentRequest;
import com.app.modules.guide.entity.LegalDocument;
import com.app.modules.guide.entity.LegalDocumentType;
import com.app.modules.guide.repository.LegalDocumentRepository;
import com.app.modules.guide.service.LegalDocumentService;
import com.app.modules.platform.service.PlatformAdminAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional
public class LegalDocumentServiceImpl implements LegalDocumentService {

    private final LegalDocumentRepository repository;
    private final PlatformAdminAccessService adminAccess;

    @Override
    @Transactional(readOnly = true)
    public LegalDocumentDto getPublished(LegalDocumentType type, String lang) {
        return repository.findById(type)
                .map(d -> LegalDocumentDto.publicOf(d, lang))
                .orElseThrow(() -> new AppException(ErrorCode.LEGAL_DOCUMENT_NOT_FOUND));
    }

    @Override
    @Transactional(readOnly = true)
    public List<LegalDocumentDto> listAdmin(UUID adminId) {
        adminAccess.requirePlatformAdmin(adminId);
        return Arrays.stream(LegalDocumentType.values())
                .map(repository::findById)
                .flatMap(java.util.Optional::stream)
                .map(d -> LegalDocumentDto.of(d, "vi"))
                .toList();
    }

    @Override
    public LegalDocumentDto update(UUID adminId, LegalDocumentType type, LegalDocumentRequest request) {
        adminAccess.requirePlatformAdmin(adminId);
        LegalDocument doc = repository.findForUpdate(type).orElseGet(() -> {
            LegalDocument created = new LegalDocument();
            created.setDocType(type);
            return created;
        });
        doc.setTitleVi(request.titleVi().trim());
        doc.setTitleEn(request.titleEn().trim());
        doc.setContentVi(request.contentVi());
        doc.setContentEn(request.contentEn());
        doc.setUpdatedBy(adminId);
        return LegalDocumentDto.of(repository.saveAndFlush(doc), "vi");
    }
}
