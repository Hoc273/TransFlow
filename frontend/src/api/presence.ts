import { apiRequest } from '@/lib/api/client'

/**
 * Presence heartbeat — records that the current user is online.
 * Fire-and-forget: called every ~60s while logged in, never blocks UI.
 */
export function postPresenceHeartbeatApi() {
  return apiRequest<{ recorded: boolean }>('/presence/heartbeat', { method: 'POST' })
}
