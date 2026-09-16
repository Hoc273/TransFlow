/**
 * B1.2 public Subtitle Style API (docs/93 §4.6.11).
 *
 * Not workspace-scoped by design: SYSTEM presets are workspace-agnostic and the
 * job-scoped routes derive access from the job's own workspace. Presets are
 * addressed by stable `key` only — never by asset UUID.
 */
import { apiRequest } from '@/lib/api/client'
import type {
  CurrentSubtitleStyle,
  SubtitleStyleDetail,
  SubtitleStylePreset,
} from '@/types/subtitleStyle'

/** All active SYSTEM presets, already ordered by sort_order server-side. */
export function listSubtitleStylePresetsApi() {
  return apiRequest<SubtitleStylePreset[]>('/media/subtitle-styles')
}

/** Full snapshot of one active preset. Key is encoded — it reaches a path segment. */
export function getSubtitleStyleApi(key: string) {
  return apiRequest<SubtitleStyleDetail>(
    `/media/subtitle-styles/${encodeURIComponent(key)}`,
  )
}

/** Snapshot currently assigned to the job; 404 STYLE_NOT_FOUND when none is. */
export function getJobSubtitleStyleApi(jobId: string) {
  return apiRequest<CurrentSubtitleStyle>(`/media/jobs/${jobId}/subtitle-style`)
}

/**
 * Assigns a preset to the job. First-write-wins server-side: the response is the
 * snapshot actually persisted, which may be a pre-existing one rather than the
 * requested preset — callers must render the response, not the requested key.
 */
export function assignJobSubtitleStyleApi(jobId: string, key: string) {
  return apiRequest<CurrentSubtitleStyle>(`/media/jobs/${jobId}/subtitle-style`, {
    method: 'POST',
    body: { key },
  })
}
