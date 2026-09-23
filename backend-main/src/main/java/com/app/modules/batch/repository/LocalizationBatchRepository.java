package com.app.modules.batch.repository;

import com.app.modules.batch.entity.LocalizationBatch;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface LocalizationBatchRepository extends JpaRepository<LocalizationBatch, UUID> {

    Optional<LocalizationBatch> findByIdAndWorkspaceId(UUID id, UUID workspaceId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<LocalizationBatch> findWithLockById(UUID id);

    List<LocalizationBatch> findByWorkspaceIdAndProjectIdOrderByCreatedAtDesc(UUID workspaceId, UUID projectId);

    // ── Platform-wide aggregates (SUPER ADMIN) ─────────────────────────────────

    interface BatchStatusCount {
        LocalizationBatch.BatchStatus getStatus();
        Long getCount();
    }

    interface WorkspaceBatchCount {
        UUID getWorkspaceId();
        Long getBatchCount();
    }

    @Query("""
            select b.status as status, count(b) as count
            from LocalizationBatch b
            where b.createdAt >= :from and b.createdAt <= :to
            group by b.status
            """)
    List<BatchStatusCount> countBatchesByStatusInRange(@Param("from") Instant from,
                                                       @Param("to") Instant to);

    @Query("""
            select b.workspaceId as workspaceId, count(b) as batchCount
            from LocalizationBatch b
            where b.createdAt >= :from and b.createdAt <= :to
            group by b.workspaceId
            """)
    List<WorkspaceBatchCount> countBatchesByWorkspaceInRange(@Param("from") Instant from,
                                                            @Param("to") Instant to);
}

