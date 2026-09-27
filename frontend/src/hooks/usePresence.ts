import { useEffect } from 'react'
import { postPresenceHeartbeatApi } from '@/api/presence'
import { useAuthStore } from '@/store/authStore'

/**
 * Sends a presence heartbeat every 60s while logged in.
 * The backend counts a user as online if a heartbeat arrived
 * within the last 2 minutes (Redis ZSET, per-user dedupe).
 */
const HEARTBEAT_INTERVAL_MS = 60_000

export function usePresenceHeartbeat() {
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!accessToken) return
    let disposed = false
    const beat = () => {
      postPresenceHeartbeatApi().catch(() => {
        // Best-effort — presence must never break the app.
      })
    }
    beat()
    const id = window.setInterval(() => {
      if (!disposed) beat()
    }, HEARTBEAT_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(id)
    }
  }, [accessToken])
}
