package com.app.modules.auth.dto;

import jakarta.validation.constraints.NotBlank;

public record GoogleExchangeRequest(
        @NotBlank String code
) {
}
