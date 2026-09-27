package com.app.modules.guide.repository;

import com.app.modules.guide.entity.LegalDocument;
import com.app.modules.guide.entity.LegalDocumentType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface LegalDocumentRepository extends JpaRepository<LegalDocument, LegalDocumentType> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from LegalDocument d where d.docType = :type")
    Optional<LegalDocument> findForUpdate(@Param("type") LegalDocumentType type);
}
