package com.app.modules.platform.repository;

import com.app.modules.platform.entity.PlatformLocalizationBatchView;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface PlatformLocalizationBatchViewRepository
        extends JpaRepository<PlatformLocalizationBatchView, UUID> {

    /** Batch counts grouped by status for batches created inside [from, to). */
    @Query("""
            select b.status as status, count(b) as cnt
            from PlatformLocalizationBatchView b
            where b.createdAt >= :from and b.createdAt < :to
            group by b.status
            """)
    List<StatusCount> countByStatusInRange(@Param("from") Instant from, @Param("to") Instant to);

    interface StatusCount {
        String getStatus();
        long getCnt();
    }
}
