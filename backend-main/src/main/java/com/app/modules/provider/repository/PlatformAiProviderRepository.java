package com.app.modules.provider.repository;

import com.app.modules.provider.entity.PlatformAiProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PlatformAiProviderRepository extends JpaRepository<PlatformAiProvider, UUID> {

    List<PlatformAiProvider> findByIsActiveTrue();

    boolean existsByNameIgnoreCase(String name);
}
