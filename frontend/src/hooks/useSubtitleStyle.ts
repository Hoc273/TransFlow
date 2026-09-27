import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  assignJobSubtitleStyleApi,
  getJobSubtitleStyleApi,
  getSubtitleStyleApi,
  listSubtitleStylePresetsApi,
} from '@/api/subtitleStyle'
import { STALE, queryKeys } from '@/lib/queryClient'
import { ApiError } from '@/types/api'
import type {
  CurrentSubtitleStyle,
  SubtitleStyleDetail,
  SubtitleStylePreset,
  SubtitleStyleSnapshot,
} from '@/types/subtitleStyle'

/** Active SYSTEM presets. Immutable server-side, so cached as static. */
export function useSubtitleStylePresets(enabled = true) {
  return useQuery({
    queryKey: queryKeys.subtitleStylePresets,
    queryFn: listSubtitleStylePresetsApi,
    staleTime: STALE.static,
    enabled,
  })
}

/**
 * Fetches the style assigned to a job.
 *
 * A 404 `STYLE_NOT_FOUND` means "nothing assigned yet" — a legitimate empty
 * state, not a failure — so it resolves to null. Any other error (403, 5xx)
 * still propagates, otherwise a permissions problem would masquerade as an
 * empty panel and invite the user to assign a style they cannot assign.
 */
export async function fetchJobSubtitleStyle(
  jobId: string,
): Promise<CurrentSubtitleStyle | null> {
  try {
    return await getJobSubtitleStyleApi(jobId)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'STYLE_NOT_FOUND') return null
    throw error
  }
}

export function useJobSubtitleStyle(jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.jobSubtitleStyle(jobId ?? ''),
    queryFn: () => fetchJobSubtitleStyle(jobId!),
    enabled: Boolean(jobId),
    staleTime: STALE.static,
  })
}

/**
 * Full snapshots for the given presets, used to identify which preset the job's
 * assigned snapshot corresponds to (the current-style response carries no key).
 */
export function useSubtitleStyleDetails(presets: SubtitleStylePreset[] | undefined) {
  const keys = useMemo(() => (presets ?? []).map((preset) => preset.key), [presets])

  const results = useQueries({
    queries: keys.map((key) => ({
      queryKey: [...queryKeys.subtitleStylePresets, key] as const,
      queryFn: () => getSubtitleStyleApi(key),
      staleTime: STALE.static,
    })),
  })

  return useMemo(
    () => results.map((result) => result.data).filter((d): d is SubtitleStyleDetail => !!d),
    [results],
  )
}

/** The 13 canonical fields — identity is the whole snapshot, not a subset. */
const SNAPSHOT_FIELDS = [
  'font_family',
  'font_size',
  'primary_color',
  'outline_color',
  'outline_width',
  'shadow',
  'bold',
  'italic',
  'alignment',
  'margin_v',
  'line_spacing',
  'background',
  'opacity',
] as const satisfies readonly (keyof SubtitleStyleSnapshot)[]

/**
 * Identifies the preset whose snapshot equals the one assigned to the job.
 *
 * Returns null when nothing matches — the assigned snapshot is immutable while
 * presets can be edited or retired, so a legacy job may legitimately hold a
 * snapshot no live preset reproduces. Callers must handle that.
 */
export function matchAssignedPreset(
  current: CurrentSubtitleStyle | null | undefined,
  details: SubtitleStyleDetail[],
): SubtitleStyleDetail | null {
  if (!current) return null

  const matches = details.filter((detail) =>
    SNAPSHOT_FIELDS.every((field) => (detail[field] ?? null) === (current[field] ?? null)),
  )
  return matches.length === 1 ? matches[0] : null
}

/**
 * Applies the authoritative assign response to the cache.
 *
 * Seeds the current-style entry with what the server actually persisted
 * (first-write-wins may return a pre-existing snapshot rather than the
 * requested preset), then invalidates to re-verify. Scoped to the
 * subtitle-style key only — assigning a style must not disturb the voice,
 * proposal or timeline panels.
 */
export function applyAssignedSubtitleStyle(
  qc: QueryClient,
  jobId: string,
  snapshot: CurrentSubtitleStyle,
) {
  qc.setQueryData(queryKeys.jobSubtitleStyle(jobId), snapshot)
  void qc.invalidateQueries({ queryKey: queryKeys.jobSubtitleStyle(jobId) })
}

export function useAssignSubtitleStyle(jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => assignJobSubtitleStyleApi(jobId, key),
    onSuccess: (snapshot) => applyAssignedSubtitleStyle(qc, jobId, snapshot),
  })
}

/**
 * Phase 5 foundation (docs/97 §19.17 §10): ownership + effective readout
 * derived from `GET /jobs/{id}/subtitle-style`. `styleAssigned` drives the
 * ownership chip and control disabling in later phases; `styledBoxMode`
 * mirrors the backend's box-mode authority on the styled path (F-12/F-13 —
 * snapshot background presence).
 */
export type StyleAssignmentState = {
  styleAssigned: boolean
  /** Full 13-field canonical snapshot when assigned; null otherwise. */
  snapshot: CurrentSubtitleStyle | null
  /** Snapshot background present ⇒ styled path renders an opaque box. */
  styledBoxMode: boolean
}

export function deriveStyleAssignment(
  current: CurrentSubtitleStyle | null | undefined,
): StyleAssignmentState {
  const assigned = current != null
  return {
    styleAssigned: assigned,
    snapshot: assigned ? current : null,
    styledBoxMode:
      assigned && current.background != null && current.background.trim() !== '',
  }
}
