package com.app.modules.platform.repository;

import com.app.modules.platform.entity.UserActivityLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

@Repository
public interface UserActivityLogRepository extends JpaRepository<UserActivityLog, UUID> {

    /**
     * {@code userId}/{@code workspaceId} null = no filter. {@code q} must be lower-case and never null
     * ('' = no filter): a null string is bound as bytea on PostgreSQL and breaks {@code locate}.
     */
    @Query(value = """
            select a from UserActivityLog a
            left join PlatformUserView u on u.id = a.userId
            where (:userId is null or a.userId = :userId)
              and (:workspaceId is null or a.workspaceId = :workspaceId)
              and (:failedOnly = false or a.statusCode >= 400)
              and (:q = ''
                   or locate(:q, lower(a.action)) > 0
                   or locate(:q, lower(u.email)) > 0)
            order by a.createdAt desc
            """,
            countQuery = """
            select count(a) from UserActivityLog a
            left join PlatformUserView u on u.id = a.userId
            where (:userId is null or a.userId = :userId)
              and (:workspaceId is null or a.workspaceId = :workspaceId)
              and (:failedOnly = false or a.statusCode >= 400)
              and (:q = ''
                   or locate(:q, lower(a.action)) > 0
                   or locate(:q, lower(u.email)) > 0)
            """)
    Page<UserActivityLog> search(@Param("userId") UUID userId,
                                 @Param("workspaceId") UUID workspaceId,
                                 @Param("q") String q,
                                 @Param("failedOnly") boolean failedOnly,
                                 Pageable pageable);

    @Modifying
    @Query("delete from UserActivityLog a where a.createdAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") Instant cutoff);
}
