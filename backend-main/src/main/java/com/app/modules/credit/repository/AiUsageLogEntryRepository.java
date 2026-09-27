package com.app.modules.credit.repository;

import com.app.modules.credit.entity.AiUsageLogEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface AiUsageLogEntryRepository extends JpaRepository<AiUsageLogEntry, UUID> {
}
