package com.app.modules.platform.repository;

import com.app.modules.platform.entity.PlatformMediaJobView;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface PlatformMediaJobViewRepository extends JpaRepository<PlatformMediaJobView, UUID> {

    /** Job counts grouped by status for jobs created inside [from, to). */
    @Query("""
            select j.status as status, count(j) as cnt
            from PlatformMediaJobView j
            where j.createdAt >= :from and j.createdAt < :to
            group by j.status
            """)
    List<StatusCount> countByStatusInRange(@Param("from") Instant from, @Param("to") Instant to);

    interface StatusCount {
        String getStatus();
        long getCnt();
    }
}
