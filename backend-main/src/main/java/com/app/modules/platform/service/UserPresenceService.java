package com.app.modules.platform.service;

import java.util.UUID;

/**
 * Tracks which users are currently online via frontend heartbeats.
 *
 * <p>A user counts as online if a heartbeat was received within the online
 * window (currently 2 minutes). Backed by Redis with an in-memory fallback.
 */
public interface UserPresenceService {

    /** Records a heartbeat for the given user (called every ~60s by the frontend). */
    void heartbeat(UUID userId);

    /** Number of distinct users with a heartbeat inside the online window. */
    long countOnline();
}
