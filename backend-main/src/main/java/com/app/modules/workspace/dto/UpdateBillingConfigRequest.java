package com.app.modules.workspace.dto;

import com.app.modules.credit.entity.CostMode;
import jakarta.validation.constraints.NotNull;

public record UpdateBillingConfigRequest(
        @NotNull CostMode costMode
) {
}
