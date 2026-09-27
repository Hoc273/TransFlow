package com.app.modules.credit.dto;

import jakarta.validation.constraints.NotBlank;

public record PurchaseCreditPackageRequest(
        @NotBlank(message = "paymentReference must not be blank")
        String paymentReference
) {
}
