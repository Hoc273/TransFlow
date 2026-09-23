package com.app.modules.platform.repository;

import com.app.modules.platform.entity.PlatformUserView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

@Repository
public interface PlatformUserViewRepository extends JpaRepository<PlatformUserView, UUID> {

    long countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(Instant from, Instant to);

    /**
     * Platform directory (API_Contract.md §13.1) — metadata only; workspaceCount via left join.
     * {@code q} and {@code isPlatformAdmin} are optional (null = no filter).
     */
    // Explicit countQuery: the derived count would drag the LEFT JOIN + GROUP BY
    // along (and rely on Hibernate's grouped-count fallback). Counting users
    // needs neither join nor grouping.
    // LOCATE() (substring match) instead of LIKE — no wildcard semantics, so %/_
    // in q are matched literally without needing escape handling.
    @Query(value = """
            select u.id as id,
                   u.email as email,
                   u.fullName as fullName,
                   u.status as status,
                   u.platformAdmin as platformAdmin,
                   u.createdAt as createdAt,
                   count(m.id) as workspaceCount
            from PlatformUserView u
            left join PlatformWorkspaceMemberView m on m.userId = u.id
            where (:q is null or :q = ''
                   or locate(lower(:q), lower(u.email)) > 0
                   or locate(lower(:q), lower(u.fullName)) > 0)
              and (:isPlatformAdmin is null or u.platformAdmin = :isPlatformAdmin)
            group by u.id, u.email, u.fullName, u.status, u.platformAdmin, u.createdAt
            order by u.createdAt desc
            """,
            countQuery = """
            select count(u.id)
            from PlatformUserView u
            where (:q is null or :q = ''
                   or locate(lower(:q), lower(u.email)) > 0
                   or locate(lower(:q), lower(u.fullName)) > 0)
              and (:isPlatformAdmin is null or u.platformAdmin = :isPlatformAdmin)
            """)
    Page<PlatformUserRow> searchDirectory(@Param("q") String q,
                                        @Param("isPlatformAdmin") Boolean isPlatformAdmin,
                                        Pageable pageable);

    interface PlatformUserRow {
        UUID getId();
        String getEmail();
        String getFullName();
        String getStatus();
        Boolean getPlatformAdmin();
        Instant getCreatedAt();
        Long getWorkspaceCount();
    }
}
