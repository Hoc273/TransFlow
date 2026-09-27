package com.app.modules.project.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record AssignProjectMemberRequest(
        @NotNull UUID userId
) {
}
