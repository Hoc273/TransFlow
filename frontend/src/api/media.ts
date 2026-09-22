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
import type { MediaAsset } from '@/types/media'

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
  jobId?: string,
) {
  if (jobId) {
    return apiRequest(
      buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/subtitles/${segmentId}`),
      {
        method: 'PATCH',
        body: {
          targetText: body.targetText,
          startMs: body.startMs,
          endMs: body.endMs,
        },
      },
    ).catch(() =>
      apiRequest(
        buildWorkspacePath(workspaceId, `/media/segments/${segmentId}`),
        {
          method: 'PUT',
          body: {
            targetText: body.targetText,
            startMs: body.startMs,
            endMs: body.endMs,
          },
        },
      ),
    )
  }

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
    body: { feedback, feedbackText: feedback },
  })
}

export type TermsVersionResponse = {
  termsVersion: string
}

/** Fetch live terms version from backend (H9 — never hardcode on FE). */
export function getMediaTermsVersionApi(workspaceId: string) {
  return apiRequest<TermsVersionResponse>(
    buildWorkspacePath(workspaceId, '/media/terms-version'),
  )
}

/** List root media assets for a project (API Contract §4, MediaAssetController). */
export function listProjectMediaAssetsApi(workspaceId: string, projectId: string) {
  return apiRequest<MediaAsset[]>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/media/assets`),
  )
}

/** Get single media asset metadata by ID (API Contract §4, MediaAssetController). */
export function getMediaAssetApi(workspaceId: string, assetId: string) {
  return apiRequest<MediaAsset>(
    buildWorkspacePath(workspaceId, `/media/assets/${assetId}`),
  )
}

/** List subtitle cues for a media job (API Contract §5, MediaJobController:128). */
export function listMediaJobSubtitlesApi(workspaceId: string, jobId: string) {
  return apiRequest<import('@/types/media').MediaSubtitleCue[]>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/subtitles`),
  )
}
