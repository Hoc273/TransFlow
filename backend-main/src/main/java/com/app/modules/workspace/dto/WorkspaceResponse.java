package com.app.modules.workspace.dto;

import com.app.modules.workspace.entity.Role;
import com.app.modules.workspace.entity.Workspace;

import java.util.UUID;

public record WorkspaceResponse(
        UUID id,
        String name,
        String slug,
        UUID ownerUserId,
        Role role
) {
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
