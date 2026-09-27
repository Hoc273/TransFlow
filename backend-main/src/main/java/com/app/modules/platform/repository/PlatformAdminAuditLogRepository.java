package com.app.modules.platform.repository;

import com.app.modules.platform.entity.PlatformAdminAuditAction;
import com.app.modules.platform.entity.PlatformAdminAuditLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PlatformAdminAuditLogRepository extends JpaRepository<PlatformAdminAuditLog, UUID> {

    /** {@code action} null = no filter. */
    @Query("""
            select a from PlatformAdminAuditLog a
            where (:action is null or a.action = :action)
            """)
    Page<PlatformAdminAuditLog> findFiltered(@Param("action") PlatformAdminAuditAction action,
                                           Pageable pageable);
}
