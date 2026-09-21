package com.app.modules.transformation.service.impl;

import com.app.modules.transformation.dto.AvailabilityProjection;
import com.app.modules.transformation.dto.ModeAvailability;
import com.app.modules.transformation.dto.ReadinessSummary;
import com.app.modules.transformation.dto.WorkerCapabilitySummary;
import com.app.modules.transformation.service.TransformationService;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Service
public class TransformationServiceImpl implements TransformationService {

    @Override
    public AvailabilityProjection getCapabilities() {
        return new AvailabilityProjection(
                "1.0",
                List.of("FAST", "STUDIO"),
                "FAST",
                Map.of(
                        "FAST", new ModeAvailability(true, null),
                        "STUDIO", new ModeAvailability(true, null)
                ),
                new WorkerCapabilitySummary("READY", 1, 1, 1),
                new ReadinessSummary(
                        "READY",
                        List.of("FAST", "STUDIO"),
                        Collections.emptyList(),
                        Instant.now().toString()
                )
        );
    }
}
