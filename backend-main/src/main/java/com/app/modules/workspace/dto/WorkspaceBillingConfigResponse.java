package com.app.modules.workspace.dto;

import com.app.modules.credit.entity.CostMode;

public record WorkspaceBillingConfigResponse(
        CostMode costMode
) {
}
