package com.app.modules.media_asset.service;

import java.io.InputStream;

/**
 * Object storage for media files (Database_Design.md §6: storage_provider/bucket_name/object_storage_key).
 */
public interface MediaStorageService {

    /** Storage provider name recorded on {@code media_assets.storage_provider}. */
    String providerName();

    /** Bucket recorded on {@code media_assets.bucket_name}. */
    String mediaBucket();

    /** Uploads a media object, creating the bucket on first use. */
    void putMediaObject(String objectKey, InputStream stream, long sizeBytes, String contentType);

    /**
     * Time-limited download URL for an object referenced as {@code "<bucket>/<objectKey>"} (the format
     * backend-media-worker reports in stage {@code output_ref}). TTL = {@code app.storage.presigned-ttl-seconds}.
     */
    String presignedGetUrl(String storageRef);
}
