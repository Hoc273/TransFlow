package com.app.modules.platform.repository;

import com.app.modules.platform.entity.PlatformAiUsageLogView;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface PlatformAiUsageLogViewRepository extends JpaRepository<PlatformAiUsageLogView, UUID> {

    // from/to must be non-null: a null Instant binds as bytea in Postgres.

    @Query("""
            select coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens
            from PlatformAiUsageLogView u
            where u.createdAt >= :from and u.createdAt < :to
            """)
    UsageTotals aggregatePlatformRange(@Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            select u.operation as operation,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens
            from PlatformAiUsageLogView u
            where u.createdAt >= :from and u.createdAt < :to
            group by u.operation
            order by u.operation
            """)
    List<UsageByOperation> aggregatePlatformByOperation(@Param("from") Instant from,
                                                        @Param("to") Instant to);

    /** Top workspaces by total tokens; jobCount = distinct media jobs consuming tokens. */
    @Query("""
            select u.workspaceId as workspaceId,
                   w.name as workspaceName,
                   coalesce(sum(u.inputTokens), 0) + coalesce(sum(u.outputTokens), 0) as totalTokens,
                   count(distinct u.mediaJobId) as jobCount
            from PlatformAiUsageLogView u, PlatformWorkspaceView w
            where w.id = u.workspaceId
              and u.createdAt >= :from and u.createdAt < :to
            group by u.workspaceId, w.name
            order by coalesce(sum(u.inputTokens), 0) + coalesce(sum(u.outputTokens), 0) desc
            """)
    List<TopWorkspaceTokens> topWorkspacesByTokens(@Param("from") Instant from,
                                                   @Param("to") Instant to,
                                                   Pageable pageable);

    interface UsageTotals {
        Long getInputTokens();
        Long getOutputTokens();
    }

    interface UsageByOperation {
        String getOperation();
        Long getInputTokens();
        Long getOutputTokens();
    }

    interface TopWorkspaceTokens {
        UUID getWorkspaceId();
        String getWorkspaceName();
        Long getTotalTokens();
        Long getJobCount();
    }
}
