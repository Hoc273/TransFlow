package com.app.modules.media_asset.service.impl;

import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.entity.MediaAsset;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_asset.service.MediaUploadSessionService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.FileSystemUtils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.DirectoryStream;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Layout per session: {@code <stagingDir>/<uploadId>/meta.json}, {@code data.bin} (chunks written
 * at their offset) and {@code parts/<index>} markers created once a chunk is fully written.
 */
@Slf4j
@Service
public class MediaUploadSessionServiceImpl implements MediaUploadSessionService {

    private static final String META = "meta.json";
    private static final String DATA = "data.bin";
    private static final String PARTS = "parts";
    private static final int COPY_BUFFER = 64 * 1024;

    record Meta(UUID uploadId, UUID workspaceId, UUID projectId, UUID userId, String fileName,
                String contentType, long sizeBytes, long chunkSize, int totalChunks,
                Instant createdAt, UUID assetId) {
        Meta withAsset(UUID id) {
            return new Meta(uploadId, workspaceId, projectId, userId, fileName, contentType,
                    sizeBytes, chunkSize, totalChunks, createdAt, id);
        }
    }

    private final MediaAssetService mediaAssetService;
    private final WorkspaceAccessService access;
    private final ObjectMapper objectMapper;
    private final Path stagingDir;
    private final long chunkSize;
    private final Duration sessionTtl;
    private final int maxActivePerUser;
    private final long minFreeBytes;
    private final Duration staleAfter;
    private final Clock clock;
    private final ConcurrentHashMap<UUID, Object> completeLocks = new ConcurrentHashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    public MediaUploadSessionServiceImpl(MediaAssetService mediaAssetService,
                                         WorkspaceAccessService access,
                                         ObjectMapper objectMapper,
                                         @Value("${app.media.upload.staging-dir:${java.io.tmpdir}/transflow-uploads}") String stagingDir,
                                         @Value("${app.media.upload.chunk-size-bytes:8388608}") long chunkSize,
                                         @Value("${app.media.upload.session-ttl:PT2H}") Duration sessionTtl,
                                         @Value("${app.media.upload.max-active-per-user:10}") int maxActivePerUser,
                                         @Value("${app.media.upload.min-free-disk-bytes:1073741824}") long minFreeBytes,
                                         @Value("${app.media.upload.stale-after:PT5M}") Duration staleAfter) {
        this(mediaAssetService, access, objectMapper, Path.of(stagingDir), chunkSize, sessionTtl,
                maxActivePerUser, minFreeBytes, Clock.systemUTC(), staleAfter);
    }

    MediaUploadSessionServiceImpl(MediaAssetService mediaAssetService, WorkspaceAccessService access,
                                  ObjectMapper objectMapper, Path stagingDir, long chunkSize, Duration sessionTtl,
                                  int maxActivePerUser, long minFreeBytes, Clock clock) {
        this(mediaAssetService, access, objectMapper, stagingDir, chunkSize, sessionTtl,
                maxActivePerUser, minFreeBytes, clock, Duration.ofMinutes(5));
    }

    MediaUploadSessionServiceImpl(MediaAssetService mediaAssetService, WorkspaceAccessService access,
                                  ObjectMapper objectMapper, Path stagingDir, long chunkSize, Duration sessionTtl,
                                  int maxActivePerUser, long minFreeBytes, Clock clock, Duration staleAfter) {
        this.staleAfter = staleAfter;
        this.mediaAssetService = mediaAssetService;
        this.access = access;
        this.objectMapper = objectMapper;
        this.stagingDir = stagingDir;
        this.chunkSize = chunkSize;
        this.sessionTtl = sessionTtl;
        this.maxActivePerUser = maxActivePerUser;
        this.minFreeBytes = minFreeBytes;
        this.clock = clock;
    }

    @Override
    public UploadSession start(UUID workspaceId, UUID userId, UUID projectId,
                               String fileName, long fileSizeBytes, String contentType) {
        access.requireProjectWriteAccess(workspaceId, userId, projectId);
        if (fileSizeBytes <= 0) {
            throw new AppException(ErrorCode.VALIDATION_ERROR);
        }
        if (fileSizeBytes > MediaAssetServiceImpl.MAX_FILE_SIZE_BYTES) {
            throw new AppException(ErrorCode.MEDIA_FILE_TOO_LARGE);
        }
        MediaAssetServiceImpl.requireVideoContentType(contentType);

        try {
            Files.createDirectories(stagingDir);
            if (activeSessions(userId) >= maxActivePerUser) {
                // Abandoned uploads (reloaded/closed tabs) must not lock the user out: drop this user's
                // sessions that received nothing for a while, oldest first, until there is room.
                evictStaleSessions(userId);
                if (activeSessions(userId) >= maxActivePerUser) {
                    throw new AppException(ErrorCode.UPLOAD_SESSION_LIMIT);
                }
            }
            if (Files.getFileStore(stagingDir).getUsableSpace() < fileSizeBytes + minFreeBytes) {
                log.warn("Upload staging disk is low on space; refusing a {} byte upload", fileSizeBytes);
                throw new AppException(ErrorCode.UPLOAD_STORAGE_FULL);
            }

            UUID uploadId = UUID.randomUUID();
            int totalChunks = (int) ((fileSizeBytes + chunkSize - 1) / chunkSize);
            Meta meta = new Meta(uploadId, workspaceId, projectId, userId, fileName, contentType,
                    fileSizeBytes, chunkSize, totalChunks, clock.instant(), null);
            Path dir = stagingDir.resolve(uploadId.toString());
            Files.createDirectories(dir.resolve(PARTS));
            Files.createFile(dir.resolve(DATA));
            writeMeta(dir, meta);
            return view(dir, meta);
        } catch (IOException ex) {
            log.error("Failed to create upload session: {}", ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    @Override
    public UploadSession putChunk(UUID workspaceId, UUID userId, UUID uploadId, int index,
                                  long contentLength, InputStream body) {
        Path dir = sessionDir(uploadId);
        Meta meta = loadOwned(dir, workspaceId, userId);
        if (meta.assetId() != null || index < 0 || index >= meta.totalChunks()) {
            throw new AppException(ErrorCode.UPLOAD_CHUNK_INVALID);
        }
        long offset = (long) index * meta.chunkSize();
        long expected = Math.min(meta.chunkSize(), meta.sizeBytes() - offset);
        if (contentLength >= 0 && contentLength != expected) {
            throw new AppException(ErrorCode.UPLOAD_CHUNK_INVALID);
        }

        try (FileChannel channel = FileChannel.open(dir.resolve(DATA), StandardOpenOption.WRITE)) {
            byte[] buffer = new byte[COPY_BUFFER];
            long written = 0;
            int read;
            while ((read = body.read(buffer)) != -1) {
                if (written + read > expected) {
                    throw new AppException(ErrorCode.UPLOAD_CHUNK_INVALID);
                }
                ByteBuffer bb = ByteBuffer.wrap(buffer, 0, read);
                while (bb.hasRemaining()) {
                    written += channel.write(bb, offset + written);
                }
            }
            if (written != expected) {
                throw new AppException(ErrorCode.UPLOAD_CHUNK_INVALID);
            }
            try {
                Files.createFile(dir.resolve(PARTS).resolve(Integer.toString(index)));
            } catch (FileAlreadyExistsException ignored) {
                // Chunk re-sent after a lost response: same bytes, same marker.
            }
        } catch (NoSuchFileException ex) {
            throw new AppException(ErrorCode.UPLOAD_SESSION_NOT_FOUND);
        } catch (IOException ex) {
            log.error("Failed to write chunk {} of upload {}: {}", index, uploadId, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
        return view(dir, meta);
    }

    @Override
    public UploadSession status(UUID workspaceId, UUID userId, UUID uploadId) {
        Path dir = sessionDir(uploadId);
        return view(dir, loadOwned(dir, workspaceId, userId));
    }

    @Override
    public MediaAsset complete(UUID workspaceId, UUID userId, UUID uploadId, String name) {
        Object lock = completeLocks.computeIfAbsent(uploadId, id -> new Object());
        try {
            synchronized (lock) {
                Path dir = sessionDir(uploadId);
                Meta meta = loadOwned(dir, workspaceId, userId);
                if (meta.assetId() != null) {
                    return mediaAssetService.getAsset(workspaceId, userId, meta.assetId());
                }
                if (countParts(dir) != meta.totalChunks()) {
                    throw new AppException(ErrorCode.UPLOAD_INCOMPLETE);
                }

                MediaAsset asset;
                try {
                    asset = mediaAssetService.createSourceAsset(workspaceId, userId, meta.projectId(),
                            dir.resolve(DATA), meta.sizeBytes(), meta.contentType(),
                            name != null && !name.isBlank() ? name : meta.fileName());
                } catch (AppException ex) {
                    // Not a playable video / too long / access revoked: the bytes are useless, drop them.
                    deleteQuietly(dir);
                    throw ex;
                }
                // Keep meta.json (with the asset id) so a retried complete stays idempotent; drop the bytes.
                writeMeta(dir, meta.withAsset(asset.getId()));
                Files.deleteIfExists(dir.resolve(DATA));
                FileSystemUtils.deleteRecursively(dir.resolve(PARTS));
                return asset;
            }
        } catch (IOException ex) {
            log.error("Failed to finalise upload {}: {}", uploadId, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        } finally {
            completeLocks.remove(uploadId, lock);
        }
    }

    @Override
    public void abort(UUID workspaceId, UUID userId, UUID uploadId) {
        Path dir = sessionDir(uploadId);
        loadOwned(dir, workspaceId, userId);
        deleteQuietly(dir);
    }

    /** Drops sessions idle for longer than the TTL (abandoned tabs, lost connections). */
    @Scheduled(fixedDelayString = "${app.media.upload.cleanup-interval:PT1H}", initialDelayString = "PT5M")
    public void deleteExpiredSessions() {
        if (!Files.isDirectory(stagingDir)) {
            return;
        }
        int deleted = 0;
        try (DirectoryStream<Path> dirs = Files.newDirectoryStream(stagingDir)) {
            for (Path dir : dirs) {
                if (Files.isDirectory(dir) && isExpired(dir)) {
                    deleteQuietly(dir);
                    deleted++;
                }
            }
        } catch (IOException ex) {
            log.warn("Upload staging cleanup failed: {}", ex.toString());
        }
        if (deleted > 0) {
            log.info("Deleted {} expired upload sessions", deleted);
        }
    }

    /** Deletes the user's unfinished sessions idle for {@code staleAfter}, oldest first, until one slot is free. */
    private void evictStaleSessions(UUID userId) throws IOException {
        List<Path> stale = new ArrayList<>();
        try (DirectoryStream<Path> dirs = Files.newDirectoryStream(stagingDir)) {
            for (Path dir : dirs) {
                if (!Files.isDirectory(dir)) {
                    continue;
                }
                Optional<Meta> meta = readMeta(dir);
                if (meta.isPresent() && meta.get().userId().equals(userId) && meta.get().assetId() == null
                        && lastActivity(dir).plus(staleAfter).isBefore(clock.instant())) {
                    stale.add(dir);
                }
            }
        }
        stale.sort(Comparator.comparing(this::lastActivity));
        for (Path dir : stale) {
            if (activeSessions(userId) < maxActivePerUser) {
                break;
            }
            log.info("Evicting stale upload session {} of user {}", dir.getFileName(), userId);
            deleteQuietly(dir);
        }
    }

    private int activeSessions(UUID userId) throws IOException {
        int count = 0;
        try (DirectoryStream<Path> dirs = Files.newDirectoryStream(stagingDir)) {
            for (Path dir : dirs) {
                if (!Files.isDirectory(dir) || isExpired(dir)) {
                    continue;
                }
                Optional<Meta> meta = readMeta(dir);
                if (meta.isPresent() && meta.get().userId().equals(userId) && meta.get().assetId() == null) {
                    count++;
                }
            }
        }
        return count;
    }

    private Path sessionDir(UUID uploadId) {
        return stagingDir.resolve(uploadId.toString());
    }

    /** Unknown, expired, finished-and-cleaned, or someone else's session all look the same: not found. */
    private Meta loadOwned(Path dir, UUID workspaceId, UUID userId) {
        Meta meta = readMeta(dir).orElseThrow(() -> new AppException(ErrorCode.UPLOAD_SESSION_NOT_FOUND));
        if (!meta.userId().equals(userId) || !meta.workspaceId().equals(workspaceId) || isExpired(dir)) {
            throw new AppException(ErrorCode.UPLOAD_SESSION_NOT_FOUND);
        }
        return meta;
    }

    private Optional<Meta> readMeta(Path dir) {
        try {
            return Optional.of(objectMapper.readValue(dir.resolve(META).toFile(), Meta.class));
        } catch (IOException ex) {
            return Optional.empty();
        }
    }

    private void writeMeta(Path dir, Meta meta) throws IOException {
        Path tmp = dir.resolve(META + ".tmp");
        objectMapper.writeValue(tmp.toFile(), meta);
        Files.move(tmp, dir.resolve(META), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private boolean isExpired(Path dir) {
        return lastActivity(dir).plus(sessionTtl).isBefore(clock.instant());
    }

    private Instant lastActivity(Path dir) {
        Instant latest = Instant.EPOCH;
        for (String name : new String[]{META, DATA}) {
            try {
                Instant t = Files.getLastModifiedTime(dir.resolve(name)).toInstant();
                if (t.isAfter(latest)) {
                    latest = t;
                }
            } catch (IOException ignored) {
                // file missing (completed session has no data.bin)
            }
        }
        return latest;
    }

    private static int countParts(Path dir) {
        try (var parts = Files.list(dir.resolve(PARTS))) {
            return (int) parts.count();
        } catch (IOException ex) {
            return 0;
        }
    }

    private static List<Integer> receivedIndexes(Path dir) {
        try (var parts = Files.list(dir.resolve(PARTS))) {
            return parts.map(p -> p.getFileName().toString())
                    .filter(n -> n.chars().allMatch(Character::isDigit))
                    .map(Integer::valueOf)
                    .sorted()
                    .toList();
        } catch (IOException ex) {
            return List.of();
        }
    }

    private UploadSession view(Path dir, Meta meta) {
        List<Integer> indexes = receivedIndexes(dir);
        return new UploadSession(meta.uploadId(), meta.chunkSize(), meta.totalChunks(), indexes.size(),
                indexes, meta.assetId() != null, lastActivity(dir).plus(sessionTtl));
    }

    private static void deleteQuietly(Path dir) {
        try {
            FileSystemUtils.deleteRecursively(dir);
        } catch (IOException ex) {
            log.warn("Failed to delete upload staging dir {}: {}", dir, ex.toString());
        }
    }
}
