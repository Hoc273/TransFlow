package com.app.modules.workspace.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateWorkspaceRequest(
        @NotBlank @Size(max = 200) String name,
        @Pattern(regexp = "^[a-z0-9-]{2,120}$", message = "slug must be lowercase alphanumeric/hyphen")
        String slug
) {
}
