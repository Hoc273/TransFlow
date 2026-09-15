package com.app.modules.media_asset.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import com.app.modules.media_asset.service.MediaStorageService;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.InputStream;

@Slf4j
@Service
public class MediaStorageServiceImpl implements MediaStorageService {

    private final MinioClient client;
    private final String mediaBucket;

    public MediaStorageServiceImpl(MinioClient client, AppProperties props) {
        this.client = client;
        this.mediaBucket = props.storage().mediaBucket();
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
