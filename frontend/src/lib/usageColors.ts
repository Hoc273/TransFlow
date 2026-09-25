/** Preferred color per AI operation so the same operation looks the same on every usage view. */
const OPERATION_COLORS: Record<string, string> = {
  SUMMARIZE_SCRIPT: '#10b981',
  SUMMARIZE: '#14b8a6',
  TRANSLATE: '#7c5cff',
  TTS: '#f59e0b',
  STT: '#38bdf8',
  VISION: '#ec4899',
  QA: '#6366f1',
}

const FALLBACK_COLORS = ['#ef4444', '#84cc16', '#f97316', '#a855f7', '#06b6d4', '#eab308']

/**
 * Assigns a distinct color to every name in the list: known operations keep their
 * preferred color, anything else (or a clash) takes the next unused fallback color.
 */
export function assignUsageColors(names: string[]): Map<string, string> {
  const result = new Map<string, string>()
  const used = new Set<string>()
  const pending: string[] = []

  for (const name of names) {
    const preferred = OPERATION_COLORS[name.toUpperCase()]
    if (preferred && !used.has(preferred)) {
      result.set(name, preferred)
      used.add(preferred)
    } else {
      pending.push(name)
    }
  }

  const pool = [...Object.values(OPERATION_COLORS), ...FALLBACK_COLORS].filter((c) => !used.has(c))
  pending.forEach((name, index) => {
    result.set(name, pool[index % pool.length])
  })
  return result
}
