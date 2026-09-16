/**
 * Legacy /media/** API surface — kept for backwards compatibility during the
 * CT4 deprecation window (docs/38 CT4.4, docs/39 V-2). All routes return
 * backend `Deprecation` headers but stay functional.
 *
 * After the CT4 frontend migration (2026-07-24):
 *   - Most routes here are thin re-exports from `@/api/transformation`,
 *     which is the canonical UL path under `/transformation/**`.
 *   - Two routes have no transformation counterpart and remain
 *     implementation-only here:
 *       1. `GET /media/terms-version` — `getMediaTermsVersionApi` aliases
 *          the transformation endpoint but keeps its old name for the
 *          `useMediaTermsVersion` hook (no break).
 *       2. `PUT /media/segments/{id}` — edit a translation segment created
 *          by the linked text job. Not part of the transformation mirror
 *          (lives on `MediaController` only); no transformation route.
 *   - `uploadMediaApi` is removed; use `uploadTransformationMediaApi` from
 *     `@/api/transformation` (XHR with identical progress events).
 *   - Create-job lives only on transformation (`recipeId` only after CT4.4
 *     prep); this file has no create-job helper.
 */
import { apiRequest, buildWorkspacePath } from '@/lib/api/client'

/**
 * PUT media subtitle segment (target + original-timeline timing).
 * Has no transformation mirror — stays on /media/**.
 */
export type EditMediaSegmentBody = {
  targetText: string
  startMs?: number
  endMs?: number
}

export function editMediaSegmentApi(
  workspaceId: string,
  segmentId: string,
  body: EditMediaSegmentBody,
) {
  return apiRequest(
    buildWorkspacePath(workspaceId, `/media/segments/${segmentId}`),
    {
      method: 'PUT',
      body: {
        targetText: body.targetText,
        startMs: body.startMs,
        endMs: body.endMs,
      },
    },
  )
}

export function refineNarrativePlanApi(workspaceId: string, jobId: string, feedback: string) {
  return apiRequest<void>(buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/refine`), {
    method: 'POST',
    body: { feedback },
  })
}

export type TermsVersionResponse = {
  termsVersion: string
}

/** Fetch live terms version from backend (H9 — never hardcode on FE). */
export function getMediaTermsVersionApi(workspaceId: string) {
  return apiRequest<TermsVersionResponse>(
    buildWorkspacePath(workspaceId, '/transformation/terms-version'),
  )
}
