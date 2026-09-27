/**
 * Subtitle timecodes for editing: `m:ss.mmm` (or `h:mm:ss.mmm` past an hour).
 * Raw millisecond fields were error-prone ("4000" vs "4:00"), so the editor
 * shows and accepts timecodes. A bare number is read as seconds ("12.5").
 */
export function formatTimecode(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const total = Math.round(ms)
  const millis = total % 1000
  const seconds = Math.floor(total / 1000) % 60
  const minutes = Math.floor(total / 60_000) % 60
  const hours = Math.floor(total / 3_600_000)
  const ss = String(seconds).padStart(2, '0')
  const mmm = String(millis).padStart(3, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}.${mmm}`
    : `${minutes}:${ss}.${mmm}`
}

/** Parse a timecode (or plain seconds) to milliseconds; null when it is not a valid time. */
export function parseTimecode(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!text) return null
  const parts = text.split(':')
  if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null
  // Only the last part may carry a fraction; minutes/seconds after the first part stay below 60.
  if (parts.slice(0, -1).some((p) => p.includes('.'))) return null
  const numbers = parts.map(Number)
  if (numbers.slice(1).some((n) => n >= 60)) return null
  const seconds = numbers.reduce((acc, n) => acc * 60 + n, 0)
  return Math.round(seconds * 1000)
}
