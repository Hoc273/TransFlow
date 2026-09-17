package com.app.modules.qa.repository;

import com.app.modules.qa.entity.QaIssueOverride;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface QaIssueOverrideRepository extends JpaRepository<QaIssueOverride, UUID> {
}
