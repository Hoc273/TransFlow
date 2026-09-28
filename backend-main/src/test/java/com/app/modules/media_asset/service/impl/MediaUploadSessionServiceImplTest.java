package com.app.modules.media_asset.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_asset.service.MediaUploadSessionService.UploadSession;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class MediaUploadSessionServiceImplTest {

    @TempDir
    Path staging;

    private final UUID ws = UUID.randomUUID();
    private final UUID project = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();
    private Instant now;
    private MediaUploadSessionServiceImpl service;

    @BeforeEach
    void setUp() {
        now = Instant.now();
        Clock clock = new Clock() {
            @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(java.time.ZoneId zone) { return this; }
            @Override public Instant instant() { return now; }
        };
        service = new MediaUploadSessionServiceImpl(mock(MediaAssetService.class), mock(WorkspaceAccessService.class),
                new ObjectMapper().findAndRegisterModules(), staging, 4, Duration.ofHours(24), 2, 0, clock);
    }

    private UploadSession start(UUID owner) {
        return service.start(ws, owner, project, "a.mp4", 10, "video/mp4");
    }

    @Test
    void chunksAreSplitAtTheConfiguredSize() {
        UploadSession s = start(user);
        assertEquals(3, s.totalChunks());

        service.putChunk(ws, user, s.uploadId(), 2, 2, new ByteArrayInputStream(new byte[]{9, 9}));
        AppException tooBig = assertThrows(AppException.class,
                () -> service.putChunk(ws, user, s.uploadId(), 1, -1, new ByteArrayInputStream(new byte[5])));
        assertEquals(ErrorCode.UPLOAD_CHUNK_INVALID, tooBig.getErrorCode());
    }

    @Test
    void activeSessionsPerUserAreCapped() {
        start(user);
        start(user);
        AppException ex = assertThrows(AppException.class, () -> start(user));
        assertEquals(ErrorCode.UPLOAD_SESSION_LIMIT, ex.getErrorCode());
        // The cap is per user.
        assertDoesNotThrow(() -> start(UUID.randomUUID()));
    }

    @Test
    void idleSessionsExpireAndAreCleanedUp() {
        UploadSession s = start(user);
        now = now.plus(Duration.ofHours(25));

        AppException ex = assertThrows(AppException.class,
                () -> service.putChunk(ws, user, s.uploadId(), 0, 4, new ByteArrayInputStream(new byte[4])));
        assertEquals(ErrorCode.UPLOAD_SESSION_NOT_FOUND, ex.getErrorCode());
        // Expired sessions no longer count toward the cap.
        assertDoesNotThrow(() -> start(user));

        service.deleteExpiredSessions();
        assertFalse(Files.exists(staging.resolve(s.uploadId().toString())));
    }
}
