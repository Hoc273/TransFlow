package com.app.modules.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateProjectRequest(
        @NotBlank @Size(max = 200) String name,
        @Size(max = 20) String sourceLang
) {
}
