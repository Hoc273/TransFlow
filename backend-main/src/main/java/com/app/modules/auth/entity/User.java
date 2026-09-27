package com.app.modules.auth.entity;

import com.app.common.entity.BaseEntity;
import com.app.modules.auth.service.EmailNormalizer;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "users")
@Getter
@Setter
public class User extends BaseEntity {

    @Column(nullable = false, length = 320)
    private String email;

    /** Alias-free mailbox ({@link EmailNormalizer#canonicalize}); derived from {@code email}, never set directly. */
    @Setter(AccessLevel.NONE)
    @Column(name = "email_canonical", length = 320)
    private String emailCanonical;

    /** Null for OAuth-only (Google) accounts. */
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "full_name", nullable = false, length = 200)
    private String fullName;

    /** Google OpenID subject; unique when present. */
    @Column(name = "google_sub")
    private String googleSub;

    @Column(name = "google_linked", nullable = false)
    private boolean googleLinked = false;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserStatus status = UserStatus.ACTIVE;

    @Column(name = "is_platform_admin", nullable = false)
    private boolean isPlatformAdmin = false;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @PrePersist
    @PreUpdate
    void syncEmailCanonical() {
        this.emailCanonical = EmailNormalizer.canonicalize(email);
    }
}
