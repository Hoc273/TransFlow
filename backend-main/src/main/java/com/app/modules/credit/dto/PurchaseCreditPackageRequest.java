package com.app.modules.credit.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PurchaseCreditPackageRequest(
        @NotBlank(message = "paymentReference must not be blank")
        @Size(max = 100, message = "paymentReference must be at most 100 characters")
        String paymentReference
) {
}
