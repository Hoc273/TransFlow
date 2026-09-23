package com.app.modules.dashboard.repository;

import com.app.modules.dashboard.entity.AiUsageLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Repository
public interface AiUsageLogReadOnlyRepository extends JpaRepository<AiUsageLog, UUID> {

    interface UsageTotals {
        Long getInputTokens();
        Long getOutputTokens();
        BigDecimal getCreditUsed();
        Long getOperations();
    }

    interface UsageByProject {
        UUID getProjectId();
        Long getInputTokens();
        Long getOutputTokens();
        BigDecimal getCreditUsed();
        Long getOperations();
    }

    interface UsageByUser {
        UUID getPerformedByUserId();
        Long getInputTokens();
        Long getOutputTokens();
        BigDecimal getCreditUsed();
        Long getOperations();
    }

    interface UsageByOperation {
        String getOperation();
        Long getInputTokens();
        Long getOutputTokens();
        BigDecimal getCreditUsed();
        Long getOperations();
    }

    // from/to must be non-null: the service defaults open bounds (a null Instant binds as bytea in Postgres).

    // ── Workspace-wide aggregates (LEAD) ───────────────────────────────────────

    @Query("""
            select coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.createdAt >= :from
              and u.createdAt <= :to
            """)
    UsageTotals aggregateWorkspaceTotals(@Param("workspaceId") UUID workspaceId,
                                        @Param("from") Instant from,
                                        @Param("to") Instant to);

    @Query("""
            select u.projectId as projectId,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.createdAt >= :from
              and u.createdAt <= :to
            group by u.projectId
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByProject> aggregateWorkspaceByProject(@Param("workspaceId") UUID workspaceId,
                                                    @Param("from") Instant from,
                                                    @Param("to") Instant to);

    @Query("""
            select u.performedByUserId as performedByUserId,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.createdAt >= :from
              and u.createdAt <= :to
            group by u.performedByUserId
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByUser> aggregateWorkspaceByUser(@Param("workspaceId") UUID workspaceId,
                                              @Param("from") Instant from,
                                              @Param("to") Instant to);

    @Query("""
            select u.operation as operation,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.createdAt >= :from
              and u.createdAt <= :to
            group by u.operation
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByOperation> aggregateWorkspaceByOperation(@Param("workspaceId") UUID workspaceId,
                                                        @Param("from") Instant from,
                                                        @Param("to") Instant to);

    // ── Project-filtered aggregates (MEMBER) ──────────────────────────────────

    @Query("""
            select coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.projectId in :projectIds
              and u.createdAt >= :from
              and u.createdAt <= :to
            """)
    UsageTotals aggregateProjectsTotals(@Param("workspaceId") UUID workspaceId,
                                       @Param("projectIds") Collection<UUID> projectIds,
                                       @Param("from") Instant from,
                                       @Param("to") Instant to);

    @Query("""
            select u.projectId as projectId,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.projectId in :projectIds
              and u.createdAt >= :from
              and u.createdAt <= :to
            group by u.projectId
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByProject> aggregateProjectsByProject(@Param("workspaceId") UUID workspaceId,
                                                   @Param("projectIds") Collection<UUID> projectIds,
                                                   @Param("from") Instant from,
                                                   @Param("to") Instant to);

    @Query("""
            select u.performedByUserId as performedByUserId,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.projectId in :projectIds
              and u.createdAt >= :from
              and u.createdAt <= :to
            group by u.performedByUserId
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByUser> aggregateProjectsByUser(@Param("workspaceId") UUID workspaceId,
                                             @Param("projectIds") Collection<UUID> projectIds,
                                             @Param("from") Instant from,
                                             @Param("to") Instant to);

    @Query("""
            select u.operation as operation,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.workspaceId = :workspaceId
              and u.projectId in :projectIds
              and u.createdAt >= :from
              and u.createdAt <= :to
            group by u.operation
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByOperation> aggregateProjectsByOperation(@Param("workspaceId") UUID workspaceId,
                                                        @Param("projectIds") Collection<UUID> projectIds,
                                                        @Param("from") Instant from,
                                                        @Param("to") Instant to);

    // ── Platform-wide aggregates (SUPER ADMIN) ─────────────────────────────────

    interface WorkspaceTokenUsage {
        UUID getWorkspaceId();
        Long getInputTokens();
        Long getOutputTokens();
        default Long getTotalTokens() {
            long in = getInputTokens() != null ? getInputTokens() : 0L;
            long out = getOutputTokens() != null ? getOutputTokens() : 0L;
            return in + out;
        }
    }

    @Query("""
            select coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.createdAt >= :from
              and u.createdAt <= :to
            """)
    UsageTotals aggregatePlatformTotals(@Param("from") Instant from,
                                        @Param("to") Instant to);

    @Query("""
            select u.operation as operation,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens,
                   coalesce(sum(u.creditUsed), 0) as creditUsed,
                   count(u) as operations
            from AiUsageLog u
            where u.createdAt >= :from
              and u.createdAt <= :to
            group by u.operation
            order by coalesce(sum(u.creditUsed), 0) desc
            """)
    List<UsageByOperation> aggregatePlatformByOperation(@Param("from") Instant from,
                                                        @Param("to") Instant to);

    @Query("""
            select u.workspaceId as workspaceId,
                   coalesce(sum(u.inputTokens), 0) as inputTokens,
                   coalesce(sum(u.outputTokens), 0) as outputTokens
            from AiUsageLog u
            where u.createdAt >= :from
              and u.createdAt <= :to
            group by u.workspaceId
            """)
    List<WorkspaceTokenUsage> aggregatePlatformByWorkspace(@Param("from") Instant from,
                                                          @Param("to") Instant to);
}
