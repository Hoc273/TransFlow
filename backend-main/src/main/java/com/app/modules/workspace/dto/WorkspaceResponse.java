package com.app.modules.workspace.dto;

import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

public record WorkspaceResponse(
        UUID id,
        String name,
        String slug,
        UUID ownerUserId,
        Role role
) {
    @JsonProperty("myRole")
    public Role getMyRole() {
        return role;
    }

    public static WorkspaceResponse from(Workspace ws, Role role) {
        return new WorkspaceResponse(
                ws.getId(),
                ws.getName(),
                ws.getSlug(),
                ws.getOwnerUserId(),
                role
        );
    }
}
