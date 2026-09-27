package com.app.modules.provider.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(name = "user_ai_provider_defaults")
@Getter
@Setter
@NoArgsConstructor
public class UserAiProviderDefault {

    @EmbeddedId
    private UserAiProviderDefaultId id;

    @Column(name = "provider_id", nullable = false)
    private UUID providerId;

    public UserAiProviderDefault(UUID userId, String capability, UUID providerId) {
        this.id = new UserAiProviderDefaultId(userId, capability);
        this.providerId = providerId;
    }
}
