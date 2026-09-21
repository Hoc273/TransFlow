package com.app.modules.transformation.dto;

import java.util.List;

public record ReadinessSummary(
        String status,
        List<String> readyExecutionModes,
        List<String> reasons,
        String evaluatedAt
) {
}
