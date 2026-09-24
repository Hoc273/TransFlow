import { useRef } from 'react'

/** Presigned URLs live 1h (storage.presignedTtlSeconds); swap well before expiry. */
const MAX_REUSE_MS = 45 * 60 * 1000

function objectIdentity(url: string): string {
  return url.split('?')[0]
}

/**
 * Every refetch of a presigned media URL returns a new signature for the same
 * object. Feeding that straight into `<video src>` makes the player drop its
 * buffer and reload from zero, so keep the first URL while it still targets
 * the same object and is comfortably inside its validity window.
 */
export function useStableMediaUrl(url: string | null | undefined, now: () => number = Date.now): string | null {
  const held = useRef<{ url: string; since: number } | null>(null)
  if (!url) {
    held.current = null
    return null
  }
  const current = held.current
  if (
    current != null
    && objectIdentity(current.url) === objectIdentity(url)
    && now() - current.since <= MAX_REUSE_MS
  ) {
    return current.url
  }
  held.current = { url, since: now() }
  return url
}
