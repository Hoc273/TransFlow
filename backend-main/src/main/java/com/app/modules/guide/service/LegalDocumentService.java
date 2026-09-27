package com.app.modules.guide.service;

import com.app.modules.guide.dto.LegalDocumentDto;
import com.app.modules.guide.dto.LegalDocumentRequest;
import com.app.modules.guide.entity.LegalDocumentType;

import java.util.List;
import java.util.UUID;

public interface LegalDocumentService {

    LegalDocumentDto getPublished(LegalDocumentType type, String lang);

    List<LegalDocumentDto> listAdmin(UUID adminId);

    LegalDocumentDto update(UUID adminId, LegalDocumentType type, LegalDocumentRequest request);
}
