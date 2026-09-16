package com.app.modules.media_asset.service.impl;

import com.app.common.config.AppProperties;
import com.app.common.exception.AppException;
import com.app.common.exception.ErrorCode;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.ByteArrayInputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MediaStorageServiceImplTest {

    @Mock
    private MinioClient client;

    private MediaStorageServiceImpl storageService;

    @BeforeEach
    void setUp() {
        AppProperties props = new AppProperties(null, null, null, null, null,
                new AppProperties.Storage("http://localhost:9000", "key", "secret", "test-media-bucket"), null);
        storageService = new MediaStorageServiceImpl(client, props);
    }

    @Test
    void providerName_isMinio() {
        assertEquals("minio", storageService.providerName());
    }

    @Test
    void mediaBucket_returnsConfiguredBucket() {
        assertEquals("test-media-bucket", storageService.mediaBucket());
    }

    @Test
    void putMediaObject_bucketMissing_createsBucketThenPuts() throws Exception {
        when(client.bucketExists(any(BucketExistsArgs.class))).thenReturn(false);

        storageService.putMediaObject("source/key1", new ByteArrayInputStream("data".getBytes()), 4L, "video/mp4");

        verify(client).makeBucket(any(MakeBucketArgs.class));
        verify(client).putObject(any(PutObjectArgs.class));
    }

    @Test
    void putMediaObject_bucketExists_skipsMakeBucket() throws Exception {
        when(client.bucketExists(any(BucketExistsArgs.class))).thenReturn(true);

        storageService.putMediaObject("source/key2", new ByteArrayInputStream("data".getBytes()), 4L, "video/mp4");

        verify(client, never()).makeBucket(any());
        verify(client).putObject(any(PutObjectArgs.class));
    }

    @Test
    void putMediaObject_minioFailure_wrapsAsUncategorizedException() throws Exception {
        when(client.bucketExists(any(BucketExistsArgs.class))).thenThrow(new RuntimeException("minio unreachable"));

        AppException ex = assertThrows(AppException.class, () ->
                storageService.putMediaObject("source/key3", new ByteArrayInputStream("data".getBytes()), 4L, "video/mp4"));
        assertEquals(ErrorCode.UNCATEGORIZED_EXCEPTION, ex.getErrorCode());
    }
}
