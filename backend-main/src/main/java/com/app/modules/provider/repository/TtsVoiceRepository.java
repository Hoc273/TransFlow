package com.app.modules.provider.repository;

import com.app.modules.provider.entity.TtsVoice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface TtsVoiceRepository extends JpaRepository<TtsVoice, UUID> {
}
