package com.app.modules.media_job.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaAssetService;
import com.app.modules.media_asset.service.MediaStorageService;
import com.app.modules.media_job.dto.BulkDownloadResponse;
import com.app.modules.media_job.entity.MediaJob;
import com.app.modules.media_job.service.MediaBulkDownloadService;
import com.app.modules.media_job.service.MediaExportService;
import com.app.modules.media_job.service.MediaJobService;
import com.app.modules.workspace.service.WorkspaceAccessService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Slf4j
@Service
public class MediaBulkDownloadServiceImpl implements MediaBulkDownloadService {

    /** Objects under this prefix are expired by the MinIO lifecycle rule set in docker-compose (minio-init). */
    static final String TMP_PREFIX = "tmp/downloads/";

    private final MediaJobService jobService;
    private final MediaExportService exportService;
    private final MediaAssetService assetService;
    private final MediaStorageService storage;
    private final WorkspaceAccessService access;
    private final AppProperties props;

    // field-injected (not via constructor) so unit tests keep the default
    @Value("${app.media-job.max-bulk-download:20}")
    private int maxSelection = 20;

    public MediaBulkDownloadServiceImpl(MediaJobService jobService, MediaExportService exportService,
                                        MediaAssetService assetService, MediaStorageService storage,
                                        WorkspaceAccessService access, AppProperties props) {
        this.jobService = jobService;
        this.exportService = exportService;
        this.assetService = assetService;
        this.storage = storage;
        this.access = access;
        this.props = props;
    }

    // ponytail: synchronous, zipped through a temp file (disk, not RAM); the selection cap keeps it short.
    // Move to async 202 + polling if 20 videos ever exceeds the request timeout.
    @Override
    public BulkDownloadResponse download(UUID workspaceId, UUID userId, UUID projectId, List<UUID> jobIds) {
        access.requireProjectAccess(workspaceId, userId, projectId);
        List<UUID> ids = List.copyOf(new LinkedHashSet<>(jobIds));
        if (ids.size() > maxSelection) {
            throw new AppException(ErrorCode.DOWNLOAD_SELECTION_TOO_LARGE);
        }

        Map<UUID, String> refs = new LinkedHashMap<>(); // included job -> render output ref
        Map<UUID, String> entryNames = new LinkedHashMap<>();
        List<BulkDownloadResponse.Skipped> skipped = new ArrayList<>();
        for (UUID id : ids) {
            try {
                MediaJob job = jobService.getJob(workspaceId, userId, id);
                if (!projectId.equals(job.getProjectId())) {
                    throw new AppException(ErrorCode.RESOURCE_NOT_FOUND); // do not reveal jobs of other projects
                }
                refs.put(id, exportService.renderOutputRef(workspaceId, userId, id));
                entryNames.put(id, entryName(workspaceId, userId, job));
            } catch (AppException ex) {
                skipped.add(new BulkDownloadResponse.Skipped(id, skipReason(ex)));
            }
        }
        if (refs.isEmpty()) {
            boolean qa = skipped.stream().anyMatch(s -> "QA_BLOCKED".equals(s.reason()));
            throw new AppException(qa ? ErrorCode.QA_BLOCKED : ErrorCode.STAGE_NOT_READY);
        }

        String zipName = "videos_" + DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC)
                .format(Instant.now()) + ".zip";
        String key = TMP_PREFIX + UUID.randomUUID() + ".zip";
        Path tmp = null;
        try {
            tmp = Files.createTempFile("bulk-download-", ".zip");
            zip(tmp, refs, entryNames);
            try (InputStream in = Files.newInputStream(tmp)) {
                storage.putMediaObject(key, in, Files.size(tmp), "application/zip");
            }
        } catch (IOException ex) {
            log.error("bulk download zip failed for project={}: {}", projectId, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        } finally {
            if (tmp != null) {
                try {
                    Files.deleteIfExists(tmp);
                } catch (IOException ex) {
                    log.warn("cannot delete temp zip {}: {}", tmp, ex.toString());
                }
            }
        }

        String url = storage.presignedGetUrl(storage.mediaBucket() + "/" + key);
        Instant expiresAt = Instant.now().plusSeconds(props.storage().presignedTtlSeconds());
        return new BulkDownloadResponse(url, zipName, expiresAt, List.copyOf(refs.keySet()), skipped);
    }

    /** Streams each video into the zip; mp4 is already compressed so deflate is switched off. */
    private void zip(Path target, Map<UUID, String> refs, Map<UUID, String> entryNames) throws IOException {
        try (OutputStream out = Files.newOutputStream(target); ZipOutputStream zos = new ZipOutputStream(out)) {
            zos.setLevel(Deflater.NO_COMPRESSION);
            for (Map.Entry<UUID, String> e : refs.entrySet()) {
                zos.putNextEntry(new ZipEntry(entryNames.get(e.getKey())));
                try (InputStream in = storage.getMediaObject(e.getValue())) {
                    in.transferTo(zos);
                }
                zos.closeEntry();
            }
        }
    }

    /** {@code <source name>_<lang>_<jobId8>.mp4}, sanitized; the job id suffix keeps names unique. */
    private String entryName(UUID workspaceId, UUID userId, MediaJob job) {
        String base = assetService.getAsset(workspaceId, userId, job.getRootAssetId()).getFileName();
        int dot = base.lastIndexOf('.');
        if (dot > 0) {
            base = base.substring(0, dot);
        }
        base = base.replaceAll("[^\\p{L}\\p{N}._-]", "_");
        if (base.length() > 60) {
            base = base.substring(0, 60);
        }
        return base + "_" + job.getTargetLang() + "_" + job.getId().toString().substring(0, 8) + ".mp4";
    }

    private static String skipReason(AppException ex) {
        return switch (ex.getErrorCode()) {
            case QA_BLOCKED -> "QA_BLOCKED";
            case STAGE_NOT_READY -> "NOT_COMPLETED";
            default -> "NOT_FOUND";
        };
    }
}
