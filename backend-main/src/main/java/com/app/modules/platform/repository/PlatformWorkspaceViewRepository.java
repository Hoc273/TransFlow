package com.app.modules.platform.repository;

import com.app.modules.platform.entity.PlatformWorkspaceView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

@Repository
public interface PlatformWorkspaceViewRepository extends JpaRepository<PlatformWorkspaceView, UUID> {

    long countByCreatedAtGreaterThanEqualAndCreatedAtLessThan(Instant from, Instant to);

    /** Platform directory (API_Contract.md §13.1) — metadata only; owner email + member count. */
    // Explicit countQuery: derived count would keep the joins + GROUP BY;
    // counting workspaces matching q needs neither.
    // LOCATE() (substring match) instead of LIKE — %/_ in q matched literally.
    @Query(value = """
            select w.id as id,
                   w.name as name,
                   w.slug as slug,
                   w.ownerUserId as ownerUserId,
                   u.email as ownerEmail,
                   count(m.id) as memberCount,
                   w.createdAt as createdAt
            from PlatformWorkspaceView w
            join PlatformUserView u on u.id = w.ownerUserId
            left join PlatformWorkspaceMemberView m on m.workspaceId = w.id
            where (:q is null or :q = ''
                   or locate(lower(:q), lower(w.name)) > 0
                   or locate(lower(:q), lower(w.slug)) > 0)
            group by w.id, w.name, w.slug, w.ownerUserId, u.email, w.createdAt
            order by w.createdAt desc
            """,
            countQuery = """
            select count(w.id)
            from PlatformWorkspaceView w
            where (:q is null or :q = ''
                   or locate(lower(:q), lower(w.name)) > 0
                   or locate(lower(:q), lower(w.slug)) > 0)
            """)
    Page<PlatformWorkspaceRow> searchDirectory(@Param("q") String q, Pageable pageable);

    interface PlatformWorkspaceRow {
        UUID getId();
        String getName();
        String getSlug();
        UUID getOwnerUserId();
        String getOwnerEmail();
        Long getMemberCount();
        Instant getCreatedAt();
    }
}
