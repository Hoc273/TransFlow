/** Locale-aware number/date helpers (09b A.0). */

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US').format(value)
}

export function formatCompactNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDateTime(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Full date + time down to the second, e.g. "15:42:10 25/09/2026" (vi). */
export function formatDateTimeDetailed(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function formatRelativeTime(iso: string, language: string): string {
  try {
    const then = new Date(iso).getTime()
    const now = Date.now()
    const diffSec = Math.round((then - now) / 1000)
    const rtf = new Intl.RelativeTimeFormat(language === 'vi' ? 'vi' : 'en', { numeric: 'auto' })
    const abs = Math.abs(diffSec)
    if (abs < 60) return rtf.format(diffSec, 'second')
    const diffMin = Math.round(diffSec / 60)
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
    const diffHr = Math.round(diffMin / 60)
    if (Math.abs(diffHr) < 48) return rtf.format(diffHr, 'hour')
    const diffDay = Math.round(diffHr / 24)
    return rtf.format(diffDay, 'day')
  } catch {
    return iso
  }
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
}
