package com.app.modules.project.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CreateProjectRequest(
        @NotBlank @Size(max = 200) String name,
        @Size(max = 20) String sourceLang,
        UUID defaultGlossaryId,
        Boolean tmEnabled,
        @Size(max = 80) String domain,
        @Size(max = 80) String tone
) {
    public CreateProjectRequest(String name, String sourceLang) {
        this(name, sourceLang, null, true, null, null);
    }
}
