package com.app.modules.credit.dto;

import jakarta.validation.constraints.Size;

/** Body of POST /api/platform/credit/purchases/{purchaseId}/approve|reject — note is optional. */
public record ReviewCreditPurchaseRequest(
        @Size(max = 255, message = "note must be at most 255 characters")
        String note
) {
}
