package com.app.modules.media_asset.service;

import java.io.InputStream;
import java.time.Instant;
import java.util.Collection;
import java.util.List;

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

    /** Opens an object referenced as {@code "<bucket>/<objectKey>"}; the caller must close the stream. */
    InputStream getMediaObject(String storageRef);

    /**
     * True only when storage confirms the object referenced as {@code "<bucket>/<objectKey>"} is
     * gone (deleted by retention). Unknown storage errors return false so the caller proceeds.
     */
    boolean objectMissing(String storageRef);

    /** Objects of the media bucket last modified before {@code cutoff} (retention sweep). */
    List<StoredObject> listMediaObjectsOlderThan(Instant cutoff);

    /** Deletes objects of the media bucket by key; returns how many were removed. */
    int removeMediaObjects(Collection<String> objectKeys);

    record StoredObject(String objectKey, Instant lastModified, long sizeBytes) {
    }
}
