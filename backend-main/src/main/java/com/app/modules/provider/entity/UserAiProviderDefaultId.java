package com.app.modules.provider.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.util.UUID;

@Embeddable
@Getter
@Setter
@NoArgsConstructor
@EqualsAndHashCode
public class UserAiProviderDefaultId implements Serializable {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "capability", nullable = false, length = 20)
    private String capability;

    public UserAiProviderDefaultId(UUID userId, String capability) {
        this.userId = userId;
        this.capability = capability;
    }
}
