package com.app.modules.guide;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.guide.dto.LegalDocumentDto;
import com.app.modules.guide.dto.LegalDocumentRequest;
import com.app.modules.guide.entity.LegalDocument;
import com.app.modules.guide.entity.LegalDocumentType;
import com.app.modules.guide.repository.LegalDocumentRepository;
import com.app.modules.guide.service.impl.LegalDocumentServiceImpl;
import com.app.modules.platform.service.PlatformAdminAccessService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LegalDocumentServiceTest {

    @Mock
    private LegalDocumentRepository repository;

    @Mock
    private PlatformAdminAccessService adminAccess;

    @InjectMocks
    private LegalDocumentServiceImpl service;

    private static LegalDocument doc(LegalDocumentType type) {
        LegalDocument d = new LegalDocument();
        d.setDocType(type);
        d.setTitleVi("Điều khoản");
        d.setTitleEn("Terms");
        d.setContentVi("Nội dung");
        d.setContentEn("");
        return d;
    }

    @Test
    void publicReadResolvesLanguageAndFallsBackToVietnamese() {
        when(repository.findById(LegalDocumentType.TERMS)).thenReturn(Optional.of(doc(LegalDocumentType.TERMS)));

        LegalDocumentDto dto = service.getPublished(LegalDocumentType.TERMS, "en");

        assertThat(dto.title()).isEqualTo("Terms");
        assertThat(dto.content()).isEqualTo("Nội dung"); // blank English content falls back to vi
        assertThat(dto.contentVi()).isNull(); // editor fields are not exposed publicly
    }

    @Test
    void publicReadOfMissingDocumentThrowsNotFound() {
        when(repository.findById(LegalDocumentType.PRIVACY)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getPublished(LegalDocumentType.PRIVACY, "vi"))
                .isInstanceOf(AppException.class)
                .extracting("errorCode").isEqualTo(ErrorCode.LEGAL_DOCUMENT_NOT_FOUND);
    }

    @Test
    void unknownPathTypeThrowsNotFound() {
        assertThatThrownBy(() -> LegalDocumentType.fromPath("cookies"))
                .isInstanceOf(AppException.class);
        assertThat(LegalDocumentType.fromPath("privacy")).isEqualTo(LegalDocumentType.PRIVACY);
    }

    @Test
    void updateRequiresPlatformAdminAndStoresEditor() {
        UUID adminId = UUID.randomUUID();
        when(repository.findForUpdate(LegalDocumentType.TERMS)).thenReturn(Optional.of(doc(LegalDocumentType.TERMS)));
        when(repository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        LegalDocumentDto dto = service.update(adminId, LegalDocumentType.TERMS,
                new LegalDocumentRequest(" Điều khoản mới ", "New terms", "## VI", "## EN"));

        verify(adminAccess).requirePlatformAdmin(adminId);
        assertThat(dto.titleVi()).isEqualTo("Điều khoản mới");
        assertThat(dto.contentEn()).isEqualTo("## EN");
    }

    @Test
    void updateByNonAdminIsRejectedBeforeTouchingData() {
        UUID userId = UUID.randomUUID();
        doThrow(new AppException(ErrorCode.UNAUTHORIZED)).when(adminAccess).requirePlatformAdmin(userId);

        assertThatThrownBy(() -> service.update(userId, LegalDocumentType.TERMS,
                new LegalDocumentRequest("a", "b", "c", "d")))
                .isInstanceOf(AppException.class);
        verify(repository, never()).findForUpdate(any());
    }
}
