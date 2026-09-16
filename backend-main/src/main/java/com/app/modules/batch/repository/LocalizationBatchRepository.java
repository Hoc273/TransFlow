package com.app.modules.batch.repository;

import com.app.modules.batch.entity.LocalizationBatch;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface LocalizationBatchRepository extends JpaRepository<LocalizationBatch, UUID> {

    Optional<LocalizationBatch> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<LocalizationBatch> findWithLockById(UUID id);

    List<LocalizationBatch> findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(UUID workspaceId, UUID projectId);
}
