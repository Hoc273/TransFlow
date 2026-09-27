import { useCallback, useState } from 'react'
import type { WorkflowPreset } from '@/types/media'

/**
 * Personal "pinned" workflow presets. Pins are a per-browser convenience for
 * finding presets quickly — not shared, not sent to the backend — so they live
 * in localStorage, keyed by workspace. Storage may be unavailable (private
 * mode, blocked site data): every access is guarded and falls back to no pins.
 */
const storageKey = (workspaceId: string) => `transflow.presetPins.${workspaceId}`

function readPins(workspaceId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writePins(workspaceId: string, pins: Set<string>) {
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify([...pins]))
  } catch {
    // Pins still work for this session; they just won't persist.
  }
}

export function usePinnedPresets(workspaceId: string) {
  const [pins, setPins] = useState<Set<string>>(() => readPins(workspaceId))
  const [loadedFor, setLoadedFor] = useState(workspaceId)
  if (loadedFor !== workspaceId) {
    setLoadedFor(workspaceId)
    setPins(readPins(workspaceId))
  }

  const toggle = useCallback(
    (presetId: string) => {
      setPins((prev) => {
        const next = new Set(prev)
        if (next.has(presetId)) next.delete(presetId)
        else next.add(presetId)
        writePins(workspaceId, next)
        return next
      })
    },
    [workspaceId],
  )

  return { pins, toggle }
}

/** Lower-case and strip Vietnamese diacritics so "phu de" matches "Phụ đề". */
export function foldSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

export function matchesPresetQuery(preset: WorkflowPreset, query: string): boolean {
  const q = foldSearchText(query)
  if (!q) return true
  return foldSearchText(`${preset.name} ${preset.description ?? ''}`).includes(q)
}

/** Search + optional pinned-only filter; pinned presets float to the top (stable otherwise). */
export function visiblePresets(
  presets: WorkflowPreset[],
  { query, pins, pinnedOnly }: { query: string; pins: Set<string>; pinnedOnly: boolean },
): WorkflowPreset[] {
  return presets
    .filter((p) => matchesPresetQuery(p, query) && (!pinnedOnly || pins.has(p.id)))
    .map((p, index) => ({ p, index }))
    .sort((a, b) => Number(pins.has(b.p.id)) - Number(pins.has(a.p.id)) || a.index - b.index)
    .map(({ p }) => p)
}
