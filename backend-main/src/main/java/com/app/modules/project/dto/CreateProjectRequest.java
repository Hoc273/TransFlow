package com.app.modules.project.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CreateProjectRequest(
        @NotBlank @Size(max = 200) String name,
        @Size(max = 20) String sourceLang
) {
}
