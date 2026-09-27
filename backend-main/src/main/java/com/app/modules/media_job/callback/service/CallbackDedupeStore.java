package com.app.modules.media_job.callback.service;

/** Idempotency store for worker callback {@code dedupeKey}s (API_Contract.md §14) — Redis-backed, not SQL. */
public interface CallbackDedupeStore {

    boolean isProcessed(String dedupeKey);

    void markProcessed(String dedupeKey);
}
