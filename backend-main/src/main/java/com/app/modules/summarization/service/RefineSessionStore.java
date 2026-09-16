package com.app.modules.summarization.service;

import java.util.UUID;

/**
 * Refine-attempt counter per media job, TTL-backed by Redis (Arch §7.4) — not a SQL table, expiry does
 * not lose saved proposals.
 */
public interface RefineSessionStore {

    /** Increments and returns the refine count for this job's current session (starts a new TTL window at 1). */
    int incrementAndGet(UUID mediaJobId);
}
