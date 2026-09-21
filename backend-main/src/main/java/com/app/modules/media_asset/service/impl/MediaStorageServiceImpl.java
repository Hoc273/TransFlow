package com.app.modules.media_asset.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import io.minio.BucketExistsArgs;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.http.Method;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;

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
