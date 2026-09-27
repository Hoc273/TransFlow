package com.app.modules.workspace.dto;

import com.app.modules.workspace.entity.Role;
import jakarta.validation.constraints.NotNull;

public record UpdateMemberRoleRequest(
        @NotNull Role role
) {
}
