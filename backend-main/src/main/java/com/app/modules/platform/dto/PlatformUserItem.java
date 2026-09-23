package com.app.modules.platform.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

/** Directory user row — allowlist only. No password_hash / google_sub. */
public record PlatformUserItem(
        UUID id,
        String email,
        String fullName,
        String status,
        @JsonProperty("isPlatformAdmin") boolean platformAdmin,
        Instant createdAt,
        long workspaceCount
) {}
