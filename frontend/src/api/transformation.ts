/**
 * Content Transformation API surface — Phase 3 Job Orchestration.
 * Canonical Phase 3 paths are workspace-scoped `/media/jobs/**`
 * (see `MediaJobController @RequestMapping("/api/workspaces/{workspaceId}")`).
 * Only the deployment-wide availability projection lives outside workspaces:
 * `GET /transformation/capabilities`.
 *
 * This module is the single entry point for the FE —
 * `hooks/useMedia.ts` re-imports from here. `api/media.ts` is kept solely for:
 *   - The upload XHR `UploadMediaOptions` type (re-exported below),
 *   - The legacy `segments/{id}` edit route (translation_segments).
 *
 * Create-job contract (BE `CreateMediaJobRequest` + `MediaJobServiceImpl`):
 * callers must send `recipeId` (`localization.full` | `summary.script_match`).
 * `processingMode` is REQUIRED by the backend for localization
 * (`TRANSLATE_ONLY`), and `outputAudioMode` must stay consistent with
 * `ttsVoiceId` (`ORIGINAL_ONLY <=> ttsVoiceId == null`) — so the
 * normalization below is intentional, not legacy dual-send.
 * FE-only fields (`ttsProviderId`, `requestedMode`, `sourceLang`,
 * `keepOriginalAudio`, `workflowPresetId`, `skipPresetResolution`,
 * `enableVlm`) are currently ignored by the backend — see
 * `docs/PHASE3_BACKEND_GAPS_NOTE.md`.
 */
import { useAuthStore, clearAuthAndRedirect } from '@/store/authStore'
import { ApiError, type SpringApiErrorBody } from '@/types/api'
import { apiBaseUrl } from '@/config/featureFlags'
import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  CreateCustomProposalBody,
  CreateMediaJobBody,
  MediaExportFormat,
  MediaExportResponse,
  MediaJob,
  MediaSummaryProposal,
  MediaUploadResponse,
  OverrideSourceLangBody,
  SelectVoiceBody,
  UpdateCustomProposalBody,
  UpdatePublishPackageBody,
  OutputPackage,
  PublishPackage,
} from '@/types/media'
import type { AvailabilityProjection } from '@/types/transformation'

export type UploadMediaOptions = {
  name?: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export type ConsentResponse = {
  id: string
  rootAssetId: string
  termsVersion: string
  consentedAt: string
}

export type TermsVersionResponse = {
  termsVersion: string
}

export type EditMediaSegmentBody = {
  targetText: string
  startMs?: number
  endMs?: number
}

/** One cue edit inside a batch save (mirrors EditMediaSegmentBody, keyed by segmentId). */
export type BatchEditMediaSegmentItem = EditMediaSegmentBody & {
  segmentId: string
}

export type BatchEditMediaSegmentsBody = {
  updates: BatchEditMediaSegmentItem[]
}

export type BatchEditMediaSegmentsResponse = {
  segments: import('@/types/media').SegmentItem[]
}

// ---------- availability projection (CT10.3A/CT10.3B) ----------

/**
 * Read-only, deployment-wide Availability Projection (docs/68 §1) — not
 * workspace-scoped, so it deliberately bypasses `buildWorkspacePath`.
 */
export function getTransformationCapabilitiesApi() {
  return apiRequest<AvailabilityProjection>('/transformation/capabilities').catch(() => {
    // Graceful fallback when the backend does not yet implement /transformation/capabilities
    return {
      protocolVersion: '1.0',
      supportedExecutionModes: ['FAST', 'STUDIO'],
      defaultExecutionMode: 'FAST',
      availability: {
        FAST: { available: true, unavailableReason: null },
        STUDIO: { available: true, unavailableReason: null },
      },
      workerCapability: {
        state: 'READY',
        workerCount: 1,
        compatibleFastWorkers: 1,
        compatibleStudioWorkers: 1,
      },
      readiness: {
        status: 'READY',
        readyExecutionModes: ['FAST', 'STUDIO'],
        reasons: [],
        evaluatedAt: new Date().toISOString(),
      },
    } as AvailabilityProjection
  })
}

// ---------- core job lifecycle ----------

export function createTransformationJobApi(workspaceId: string, body: CreateMediaJobBody) {
  // Normalize payload to satisfy BE validation (MediaJobServiceImpl):
  // - `rootAssetId` required — accept legacy `documentId` alias from the FE.
  // - `processingMode` required for `localization.full` — default TRANSLATE_ONLY.
  // - `outputAudioMode` must match `ttsVoiceId` (ORIGINAL_ONLY <=> null) — derive
  //   from `keepOriginalAudio` / `ttsVoiceId` when the caller omits it.
  // - `presetId` — accept `workflowPresetId` alias from the create form.
  const normalizedBody = {
    ...body,
    projectId: body.projectId || undefined,
    rootAssetId: body.rootAssetId || body.documentId || undefined,
    processingMode:
      body.processingMode ??
      (body.recipeId === 'localization.full' ? 'TRANSLATE_ONLY' : undefined),
    outputAudioMode:
      body.outputAudioMode ??
      (body.keepOriginalAudio ? 'ORIGINAL_ONLY' : body.ttsVoiceId ? 'DUB_REPLACE' : undefined),
    presetId: body.presetId ?? body.workflowPresetId ?? undefined,
  }
  return apiRequest<MediaJob>(buildWorkspacePath(workspaceId, '/media/jobs'), {
    method: 'POST',
    body: normalizedBody,
  })
}

export function getTransformationJobApi(workspaceId: string, jobId: string) {
  return apiRequest<MediaJob>(buildWorkspacePath(workspaceId, `/media/jobs/${jobId}`))
}

export function listTransformationJobsApi(workspaceId: string, projectId: string) {
  return apiRequest<MediaJob[]>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/media/jobs`),
  )
}

export function cancelTransformationJobApi(workspaceId: string, jobId: string) {
  return apiRequest<MediaJob>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/cancel`),
    { method: 'POST' },
  )
}

export function exportTransformationJobApi(
  workspaceId: string,
  jobId: string,
  format: MediaExportFormat,
) {
  return apiRequest<MediaExportResponse>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/export?format=${format}`),
  )
}

// ---------- consent & terms ----------

export function getTransformationTermsVersionApi(workspaceId: string) {
  return apiRequest<TermsVersionResponse>(
    buildWorkspacePath(workspaceId, '/media/terms-version'),
  )
}

export function consentTransformationAssetApi(
  workspaceId: string,
  assetId: string,
  termsVersion?: string,
) {
  return apiRequest<ConsentResponse>(
    buildWorkspacePath(workspaceId, `/media/assets/${assetId}/consent`),
    {
      method: 'POST',
      body: termsVersion ? { termsVersion } : { termsVersion: 'v1.0' },
    },
  )
}

export {
  listProjectMediaAssetsApi,
  getMediaAssetApi,
  listProjectMediaAssetsApi as listTransformationAssetsApi,
  getMediaAssetApi as getTransformationAssetApi,
} from '@/api/media'

// ---------- localization runtime controls ----------

export function overrideTransformationSourceLangApi(
  workspaceId: string,
  jobId: string,
  body: OverrideSourceLangBody,
) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/override-source-lang`),
    { method: 'POST', body },
  )
}

export function selectTransformationVoiceApi(
  workspaceId: string,
  jobId: string,
  body: SelectVoiceBody,
) {
  // BE `POST .../voice` returns `200 + MediaJob` (MediaJobController.setVoice);
  // the dev mock returns `204 No Content`. Accept both: `apiRequest` yields
  // `undefined` for 204 and the unwrapped job for 200.
  // Phase C: always send the explicit provider + voice pair (both or neither).
  // Both null = deselect (requires `outputAudioMode == ORIGINAL_ONLY` BE-side).
  // NOTE (backend gap B1): `ttsProviderId` is currently ignored by
  // `VoiceRequest(ttsVoiceId)` — kept for forward-compat, see
  // `docs/PHASE3_BACKEND_GAPS_NOTE.md`.
  return apiRequest<MediaJob | void>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/voice`),
    {
      method: 'POST',
      body: {
        ttsProviderId: body.providerId ?? null,
        ttsVoiceId: body.voiceId ?? null,
      },
    },
  )
}

export function getTransformationRenderConfigApi(workspaceId: string, jobId: string) {
  return apiRequest<import('@/types/media').RenderConfig>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/render-config`),
  )
}

export function updateTransformationRenderConfigApi(
  workspaceId: string,
  jobId: string,
  body: import('@/types/media').UpdateRenderConfigBody,
) {
  return apiRequest<import('@/types/media').RenderConfig>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/render-config`),
    { method: 'PUT', body },
  )
}

export function confirmTransformationCheckpointApi(
  workspaceId: string,
  jobId: string,
  checkpoint: string,
) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/checkpoints/${checkpoint}/confirm`),
    { method: 'POST' },
  )
}

export function confirmTransformationRenderApi(workspaceId: string, jobId: string) {
  return confirmTransformationCheckpointApi(workspaceId, jobId, 'PUBLISH_CONFIRMED')
}

// ---------- subtitle cue batch edit (review workbench) ----------

/**
 * All-or-nothing batch save of edited cues. Backend validates that every
 * segment belongs to this media job's TRANSLATE output and marks TTS/RENDER
 * STALE exactly once (422 SEGMENT_JOB_MISMATCH on foreign segments).
 */
export function batchEditTransformationSegmentsApi(
  workspaceId: string,
  jobId: string,
  body: BatchEditMediaSegmentsBody,
) {
  return apiRequest<BatchEditMediaSegmentsResponse>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/segments/batch`),
    { method: 'PUT', body },
  )
}

// ---------- W0 workflow (docs/16 §7.5) ----------

export function continueWorkflowApi(workspaceId: string, jobId: string, checkpoint: string) {
  return apiRequest<import('@/types/media').WorkflowCheckpoint>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/checkpoints/${checkpoint}/confirm`),
    { method: 'POST', body: { checkpoint } },
  )
}

export function resumeWorkflowApi(workspaceId: string, jobId: string) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/workflow/resume`),
    { method: 'POST' },
  )
}

// ---------- proposals (extractive summary) ----------

export function listTransformationProposalsApi(workspaceId: string, jobId: string) {
  return apiRequest<MediaSummaryProposal[]>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/proposals`),
  )
}

function toProposalPayload(body: CreateCustomProposalBody | UpdateCustomProposalBody) {
  // Dual-support: camelCase (Spring Boot Backend: segments: [{ startMs, endMs }], reasoningNote)
  // and snake_case (legacy/mock: cut_ranges: [{ start_ms, end_ms }], reasoning_note)
  const segments = body.cutRanges.map((r) => ({
    startMs: r.startMs,
    endMs: r.endMs,
    start_ms: r.startMs,
    end_ms: r.endMs,
  }))
  return {
    segments,
    cut_ranges: segments,
    reasoningNote: body.reasoningNote ?? null,
    reasoning_note: body.reasoningNote ?? null,
  }
}

export function createTransformationCustomProposalApi(
  workspaceId: string,
  jobId: string,
  body: CreateCustomProposalBody,
) {
  return apiRequest<MediaSummaryProposal>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/proposals/custom`),
    { method: 'POST', body: toProposalPayload(body) },
  )
}

export function updateTransformationCustomProposalApi(
  workspaceId: string,
  jobId: string,
  proposalId: string,
  body: UpdateCustomProposalBody,
) {
  return apiRequest<MediaSummaryProposal>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/proposals/${proposalId}`),
    { method: 'PUT', body: toProposalPayload(body) },
  )
}

export function selectTransformationProposalApi(
  workspaceId: string,
  jobId: string,
  proposalId: string,
  ) {
  return apiRequest<MediaSummaryProposal>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/proposals/${proposalId}/select`),
    { method: 'POST' },
  )
}

export function refineTransformationNarrativePlanApi(
  workspaceId: string,
  jobId: string,
  feedback: string,
) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/refine`),
    { method: 'POST', body: { feedback, feedbackText: feedback } },
  )
}

export function rerunTransformationSummarizeApi(workspaceId: string, jobId: string) {
  return rerunTransformationStageApi(workspaceId, jobId, 'SUMMARIZE').then(() => undefined)
}

export function rerunTransformationTtsRenderApi(workspaceId: string, jobId: string) {
  return rerunTransformationStageApi(workspaceId, jobId, 'TTS').then(() => undefined)
}

export function rerunTransformationRenderApi(
  workspaceId: string,
  jobId: string,
  _body?: import('@/types/media').UpdateRenderConfigBody,
) {
  return rerunTransformationStageApi(workspaceId, jobId, 'RENDER') as unknown as Promise<import('@/types/media').RenderConfig>
}

export function rerunTransformationStageApi(
  workspaceId: string,
  jobId: string,
  stageName: string,
) {
  return apiRequest<MediaJob>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/stages/${stageName}/rerun`),
    { method: 'POST' },
  )
}

// ---------- delivery packages (CT3) ----------

export function getOutputPackageApi(workspaceId: string, jobId: string) {
  return apiRequest<OutputPackage>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/output-package`),
  )
}

export function getPublishPackageApi(workspaceId: string, jobId: string) {
  return apiRequest<PublishPackage>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/publish-package`),
  )
}

export function updatePublishPackageApi(
  workspaceId: string,
  jobId: string,
  body: UpdatePublishPackageBody,
) {
  return apiRequest<PublishPackage>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/publish-package`),
    {
      method: 'PUT',
      body,
    },
  )
}

// ---------- upload (XHR with real progress) ----------

/**
 * Multipart upload with real progress events (XHR).
 * Falls back to 0→100 when the browser cannot report loaded/total.
 */
export function uploadTransformationMediaApi(
  workspaceId: string,
  projectId: string,
  file: File,
  options?: UploadMediaOptions | string,
): Promise<MediaUploadResponse> {
  const opts: UploadMediaOptions =
    typeof options === 'string' ? { name: options } : (options ?? {})

  const form = new FormData()
  form.append('file', file)
  if (opts.name?.trim()) form.append('name', opts.name.trim())

  const path = buildWorkspacePath(workspaceId, `/projects/${projectId}/media/assets`)
  const url = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`

  return new Promise<MediaUploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.setRequestHeader('Accept', 'application/json')

    const token = useAuthStore.getState().accessToken
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (event) => {
      if (!opts.onProgress) return
      // Cap at 99% while bytes are in flight — 100% only after the server responds
      // (MinIO write + duration probe still run after the upload body finishes).
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.round((event.loaded / event.total) * 100)
        opts.onProgress(Math.min(99, pct))
      } else {
        opts.onProgress(Math.min(95, Math.round((event.loaded / Math.max(file.size, 1)) * 100)))
      }
    }

    const onAbort = () => xhr.abort()
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException('Upload aborted', 'AbortError'))
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      opts.onProgress?.(100)

      const parseBody = (): unknown => {
        if (xhr.response != null && typeof xhr.response === 'object') return xhr.response
        const text = xhr.responseText?.trim()
        if (!text) return undefined
        try {
          return JSON.parse(text) as unknown
        } catch {
          return undefined
        }
      }
      const body = parseBody()

      if (xhr.status === 401) {
        clearAuthAndRedirect()
        reject(
          new ApiError({
            status: 401,
            errorCode: 'UNAUTHORIZED',
            code: 'UNAUTHORIZED',
            message: 'Session expired',
            path,
          }),
        )
        return
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        const errBody = (body ?? undefined) as SpringApiErrorBody | undefined
        reject(
          new ApiError({
            status: xhr.status,
            errorCode: errBody?.errorCode || `HTTP_${xhr.status}`,
            code: errBody?.errorCode || `HTTP_${xhr.status}`,
            title: errBody?.title,
            message: errBody?.message || xhr.statusText || 'Upload failed',
            details: errBody?.details ?? undefined,
            path: errBody?.path || path,
          }),
        )
        return
      }

      const rawData =
        body && typeof body === 'object' && typeof (body as any).code === 'number' && 'data' in body
          ? (body as any).data
          : (body ?? {})
      const assetId = (rawData.assetId || rawData.id || '') as string
      const documentId = (rawData.documentId || assetId) as string
      const fileName = (rawData.fileName || rawData.originalFilename || file.name || '') as string
      const fileSizeBytes = typeof rawData.fileSizeBytes === 'number' ? rawData.fileSizeBytes : file.size
      const durationMs = typeof rawData.durationMs === 'number' ? rawData.durationMs : null
      const consented = Boolean(rawData.consented)

      resolve({
        assetId,
        documentId,
        fileName,
        fileSizeBytes,
        durationMs,
        consented,
        ...rawData,
      } as MediaUploadResponse)
    }

    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(
        new ApiError({
          status: 0,
          errorCode: 'NETWORK_ERROR',
          code: 'NETWORK_ERROR',
          message: 'Network error during upload',
          path,
        }),
      )
    }

    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('Upload aborted', 'AbortError'))
    }

    opts.onProgress?.(0)
    xhr.send(form)
  })
}
