package com.app.modules.media_asset.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.ListObjectsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectsArgs;
import io.minio.Result;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.http.Method;
import io.minio.messages.DeleteError;
import io.minio.messages.DeleteObject;
import io.minio.messages.Item;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

@Slf4j
@Service
public class MediaStorageServiceImpl implements MediaStorageService {

    private final MinioClient client;
    private final String mediaBucket;
    private final int presignedTtlSeconds;
    /** Signs download URLs against the browser-reachable address; same as {@link #client} when none is configured. */
    private final MinioClient signer;

    public MediaStorageServiceImpl(MinioClient client, AppProperties props) {
        this.client = client;
        this.mediaBucket = props.storage().mediaBucket();
        this.presignedTtlSeconds = props.storage().presignedTtlSeconds();
        String publicEndpoint = props.storage().publicEndpoint();
        this.signer = publicEndpoint == null || publicEndpoint.isBlank()
                ? client
                // Explicit region => signing is offline (no lookup call to an address we may not reach).
                // ponytail: assumes MinIO's default region; add a config knob if the server sets MINIO_REGION.
                : MinioClient.builder().endpoint(publicEndpoint)
                        .credentials(props.storage().accessKey(), props.storage().secretKey())
                        .region("us-east-1").build();
    }

    @Override
    public String presignedGetUrl(String storageRef) {
        int slash = storageRef == null ? -1 : storageRef.indexOf('/');
        if (slash <= 0 || slash == storageRef.length() - 1) {
            throw new AppException(ErrorCode.RESOURCE_NOT_FOUND);
        }
        try {
            return signer.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                    .method(Method.GET)
                    .bucket(storageRef.substring(0, slash))
                    .object(storageRef.substring(slash + 1))
                    .expiry(presignedTtlSeconds)
                    .build());
        } catch (Exception ex) {
            log.error("minio presign failed for ref={}: {}", storageRef, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    @Override
    public InputStream getMediaObject(String storageRef) {
        int slash = storageRef == null ? -1 : storageRef.indexOf('/');
        if (slash <= 0 || slash == storageRef.length() - 1) {
            throw new AppException(ErrorCode.RESOURCE_NOT_FOUND);
        }
        try {
            return client.getObject(GetObjectArgs.builder()
                    .bucket(storageRef.substring(0, slash)).object(storageRef.substring(slash + 1)).build());
        } catch (Exception ex) {
            log.error("minio getObject failed for ref={}: {}", storageRef, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }

    @Override
    public boolean objectMissing(String storageRef) {
        int slash = storageRef == null ? -1 : storageRef.indexOf('/');
        if (slash <= 0 || slash == storageRef.length() - 1) {
            return true;
        }
        try {
            client.statObject(StatObjectArgs.builder()
                    .bucket(storageRef.substring(0, slash)).object(storageRef.substring(slash + 1)).build());
            return false;
        } catch (ErrorResponseException ex) {
            String code = ex.errorResponse() == null ? null : ex.errorResponse().code();
            if ("NoSuchKey".equals(code) || "NoSuchBucket".equals(code) || "NoSuchObject".equals(code)) {
                return true;
            }
            log.warn("minio stat failed for ref={}: {}", storageRef, ex.toString());
            return false; // unknown: let the download itself report the problem
        } catch (Exception ex) {
            log.warn("minio stat failed for ref={}: {}", storageRef, ex.toString());
            return false;
        }
    }

    @Override
    public List<StoredObject> listMediaObjectsOlderThan(Instant cutoff) {
        List<StoredObject> result = new ArrayList<>();
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(mediaBucket).build())) {
                return result;
            }
            for (Result<Item> entry : client.listObjects(ListObjectsArgs.builder()
                    .bucket(mediaBucket).recursive(true).build())) {
                Item item = entry.get();
                if (item.isDir() || item.lastModified() == null) {
                    continue;
                }
                Instant modified = item.lastModified().toInstant();
                if (modified.isBefore(cutoff)) {
                    result.add(new StoredObject(item.objectName(), modified, item.size()));
                }
            }
        } catch (Exception ex) {
            log.error("minio list failed for bucket={}: {}", mediaBucket, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
        return result;
    }

    @Override
    public int removeMediaObjects(Collection<String> objectKeys) {
        if (objectKeys == null || objectKeys.isEmpty()) {
            return 0;
        }
        List<DeleteObject> targets = objectKeys.stream().map(DeleteObject::new).toList();
        int failed = 0;
        for (Result<DeleteError> error : client.removeObjects(RemoveObjectsArgs.builder()
                .bucket(mediaBucket).objects(targets).build())) {
            failed++;
            try {
                DeleteError e = error.get();
                log.warn("minio delete failed key={}: {}", e.objectName(), e.message());
            } catch (Exception ex) {
                log.warn("minio delete failed: {}", ex.toString());
            }
        }
        return targets.size() - failed;
    }

    @Override
    public String providerName() {
        return "minio";
    }

    @Override
    public String mediaBucket() {
        return mediaBucket;
    }

    @Override
    public void putMediaObject(String objectKey, InputStream stream, long sizeBytes, String contentType) {
        try {
            boolean exists = client.bucketExists(BucketExistsArgs.builder().bucket(mediaBucket).build());
            if (!exists) {
                client.makeBucket(MakeBucketArgs.builder().bucket(mediaBucket).build());
            }
            client.putObject(PutObjectArgs.builder()
                    .bucket(mediaBucket)
                    .object(objectKey)
                    .stream(stream, sizeBytes, -1)
                    .contentType(contentType)
                    .build());
        } catch (Exception ex) {
            log.error("minio putObject failed for key={}: {}", objectKey, ex.toString());
            throw new AppException(ErrorCode.UNCATEGORIZED_EXCEPTION);
        }
    }
}
