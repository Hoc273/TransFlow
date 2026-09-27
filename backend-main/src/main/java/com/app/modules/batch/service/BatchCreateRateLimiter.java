package com.app.modules.batch.service;

import java.util.UUID;

/** Per-user batch-creation rate limit (API_Contract.md §6 — "429 nếu vượt rate limit tạo batch"). */
public interface BatchCreateRateLimiter {

    /** Returns true (and counts the attempt) if the user has exceeded the limit for the current window. */
    boolean isRateLimited(UUID userId);
}
