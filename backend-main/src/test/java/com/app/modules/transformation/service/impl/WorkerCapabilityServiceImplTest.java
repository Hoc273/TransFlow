package com.app.modules.transformation.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.health.HealthResult;
import com.app.common.health.ServiceHealthProbe;
import com.app.modules.transformation.dto.AvailabilityProjection;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkerCapabilityServiceImplTest {

    private static final String AI_URL = "http://ai";
    private static final String WORKER_URL = "http://mw";

    private ServiceHealthProbe probe;
    private WorkerCapabilityServiceImpl service;

    private static HealthResult up(Map<String, Object> body) {
        return new HealthResult(true, 5, body);
    }

    private static HealthResult down() {
        return new HealthResult(false, 100, Map.of());
    }

    private static Map<String, Object> aiBodyWithSeparation(String engine) {
        return Map.of("status", "ok", "separation", Map.of("engine", engine));
    }

    @BeforeEach
    void setUp() {
        probe = mock(ServiceHealthProbe.class);
        AppProperties props = new AppProperties(
                null, null, null, null, null, null,
                null, null,
                new AppProperties.Ai(AI_URL, 5000, 30000, 3));
        service = new WorkerCapabilityServiceImpl(props, probe, WORKER_URL, 5);
    }

    @Test
    void bothUpWithSeparation_allModesAvailable_ready() {
        when(probe.probe(AI_URL)).thenReturn(up(aiBodyWithSeparation("local_demucs")));
        when(probe.probe(WORKER_URL)).thenReturn(up(Map.of("status", "ok")));

        AvailabilityProjection p = service.getCapabilities();

        assertEquals("1.0", p.protocolVersion());
        assertEquals("FAST", p.defaultExecutionMode());
        assertTrue(p.availability().get("FAST").available());
        assertNull(p.availability().get("FAST").unavailableReason());
        assertTrue(p.availability().get("STUDIO").available());
        assertEquals("READY", p.workerCapability().state());
        assertEquals(1, p.workerCapability().workerCount());
        assertEquals(1, p.workerCapability().compatibleFastWorkers());
        assertEquals(1, p.workerCapability().compatibleStudioWorkers());
        assertEquals("READY", p.readiness().status());
        assertEquals(2, p.readiness().readyExecutionModes().size());
        assertTrue(p.readiness().reasons().isEmpty());
    }

    @Test
    void separationDisabled_studioUnavailable_degradedReadiness() {
        when(probe.probe(AI_URL)).thenReturn(up(aiBodyWithSeparation("none")));
        when(probe.probe(WORKER_URL)).thenReturn(up(Map.of("status", "ok")));

        AvailabilityProjection p = service.getCapabilities();

        assertTrue(p.availability().get("FAST").available());
        assertFalse(p.availability().get("STUDIO").available());
        assertEquals("SEPARATION_DISABLED", p.availability().get("STUDIO").unavailableReason());
        assertEquals("READY", p.workerCapability().state());
        assertEquals(1, p.workerCapability().compatibleFastWorkers());
        assertEquals(0, p.workerCapability().compatibleStudioWorkers());
        assertEquals("DRAINING", p.readiness().status());
        assertEquals(1, p.readiness().readyExecutionModes().size());
        assertTrue(p.readiness().reasons().contains("SEPARATION_DISABLED"));
    }

    @Test
    void aiDown_bothModesUnavailable_degraded() {
        when(probe.probe(AI_URL)).thenReturn(down());
        when(probe.probe(WORKER_URL)).thenReturn(up(Map.of("status", "ok")));

        AvailabilityProjection p = service.getCapabilities();

        assertFalse(p.availability().get("FAST").available());
        assertEquals("AI_GATEWAY_DOWN", p.availability().get("FAST").unavailableReason());
        assertFalse(p.availability().get("STUDIO").available());
        assertEquals("AI_GATEWAY_DOWN", p.availability().get("STUDIO").unavailableReason());
        assertEquals("DEGRADED", p.workerCapability().state());
        assertEquals(1, p.workerCapability().workerCount());
        assertEquals("DRAINING", p.readiness().status());
        assertTrue(p.readiness().readyExecutionModes().isEmpty());
    }

    @Test
    void workerDown_bothModesUnavailable_degraded() {
        when(probe.probe(AI_URL)).thenReturn(up(aiBodyWithSeparation("local_demucs")));
        when(probe.probe(WORKER_URL)).thenReturn(down());

        AvailabilityProjection p = service.getCapabilities();

        assertFalse(p.availability().get("FAST").available());
        assertEquals("MEDIA_WORKER_DOWN", p.availability().get("FAST").unavailableReason());
        assertEquals("MEDIA_WORKER_DOWN", p.availability().get("STUDIO").unavailableReason());
        assertEquals("DEGRADED", p.workerCapability().state());
        assertEquals(0, p.workerCapability().workerCount());
        assertEquals(0, p.workerCapability().compatibleFastWorkers());
    }

    @Test
    void bothDown_offline() {
        when(probe.probe(AI_URL)).thenReturn(down());
        when(probe.probe(WORKER_URL)).thenReturn(down());

        AvailabilityProjection p = service.getCapabilities();

        assertEquals("OFFLINE", p.workerCapability().state());
        assertFalse(p.availability().get("FAST").available());
        assertFalse(p.availability().get("STUDIO").available());
        assertEquals("DRAINING", p.readiness().status());
    }

    @Test
    void probeThrows_treatedAsDown_noExceptionPropagated() {
        when(probe.probe(AI_URL)).thenThrow(new RuntimeException("boom"));
        when(probe.probe(WORKER_URL)).thenReturn(up(Map.of("status", "ok")));

        AvailabilityProjection p = service.getCapabilities();

        assertFalse(p.availability().get("FAST").available());
        assertEquals("AI_GATEWAY_DOWN", p.availability().get("FAST").unavailableReason());
        assertEquals("DEGRADED", p.workerCapability().state());
    }

    @Test
    void cache_secondCallWithinTtl_probesOnce() {
        when(probe.probe(AI_URL)).thenReturn(up(aiBodyWithSeparation("local_demucs")));
        when(probe.probe(WORKER_URL)).thenReturn(up(Map.of("status", "ok")));

        service.getCapabilities();
        service.getCapabilities();

        verify(probe, times(1)).probe(AI_URL);
        verify(probe, times(1)).probe(WORKER_URL);
    }

    @Test
    void cache_zeroTtl_probesEveryCall() {
        AppProperties props = new AppProperties(
                null, null, null, null, null, null,
                null, null,
                new AppProperties.Ai(AI_URL, 5000, 30000, 3));
        service = new WorkerCapabilityServiceImpl(props, probe, WORKER_URL, 0);
        when(probe.probe(AI_URL)).thenReturn(up(aiBodyWithSeparation("local_demucs")));
        when(probe.probe(WORKER_URL)).thenReturn(up(Map.of("status", "ok")));

        service.getCapabilities();
        service.getCapabilities();

        verify(probe, times(2)).probe(AI_URL);
    }
}
