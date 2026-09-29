/**
 * Content Transformation API surface — Phase 3 Job Orchestration.
 * Canonical Phase 3 paths are workspace-scoped `/media/jobs/**`
 * (see `MediaJobController @RequestMapping("/api/workspaces/{workspaceId}")`).
 * Only the deployment-wide availability projection lives outside workspaces:
 * `GET /transformation/capabilities`.
 *
 * This module is the single entry point for the FE —
 * `hooks/useMedia.ts` re-imports from here. `api/media.ts` is kept solely for:
 *   - The chunked upload `UploadMediaOptions` type (re-exported below),
 *   - The legacy `segments/{id}` edit route (translation_segments).
 *
 * Create-job contract (BE `CreateMediaJobRequest` + `MediaJobServiceImpl`):
 * callers must send `recipeId` (`localization.full` | `summary.script_match`).
 * `processingMode` is REQUIRED by the backend for localization
 * (`TRANSLATE_ONLY`). The audio mode is resolved by the backend from the
 * voice and `requestedMode` (API_Contract §5.2): no voice / `keepOriginalAudio`
 * = ORIGINAL_ONLY; a voice = DUB_MIX, FAST as a voice-over on the original
 * track, STUDIO with source separation (GPU only). Only an explicit
 * `outputAudioMode` from the caller is forwarded.
 * FE-only fields (`sourceLang`, `workflowPresetId`, `skipPresetResolution`,
 * `enableVlm`) are currently ignored by the backend — see
 * `docs/PHASE3_BACKEND_GAPS_NOTE.md`.
 */
import { ApiError } from '@/types/api'
import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  CreateCustomProposalBody,
  CreateMediaJobBody,
  MediaExportFormat,
  MediaExportResponse,
  MediaJob,
  MediaSummaryProposal,
  MediaUploadResponse,
  NarrativePlan,
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

export type BatchEditMediaSegmentsResponse = import('@/types/media').SegmentItem[]

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
  // - `outputAudioMode` — ORIGINAL_ONLY when keeping the original audio; with a
  //   voice it is left to the backend, which picks DUB_MIX from `requestedMode`.
  // - `presetId` — accept `workflowPresetId` alias from the create form.
  const normalizedBody = {
    ...body,
    projectId: body.projectId || undefined,
    rootAssetId: body.rootAssetId || body.documentId || undefined,
    recipeId:
      body.recipeId === 'summary.generative' ? 'summary.script_match' : body.recipeId,
    processingMode:
      body.processingMode ??
      (body.recipeId === 'localization.full' ? 'TRANSLATE_ONLY' : undefined),
    outputAudioMode:
      body.outputAudioMode ?? (body.keepOriginalAudio ? 'ORIGINAL_ONLY' : undefined),
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
      body: { termsVersion: termsVersion?.trim() || 'v1' },
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

export function normalizeCheckpoint(checkpoint: string): string {
  const c = (checkpoint || '').trim().toUpperCase()
  if (c === 'CUT' || c === 'CUT_CONFIRMED') return 'CUT_CONFIRMED'
  if (c === 'REVIEW' || c === 'REVIEW_CONFIRMED') return 'REVIEW_CONFIRMED'
  if (c === 'EXPORT' || c === 'PUBLISH' || c === 'PUBLISH_CONFIRMED') return 'PUBLISH_CONFIRMED'
  return c
}

export function continueWorkflowApi(workspaceId: string, jobId: string, checkpoint: string) {
  const normalized = normalizeCheckpoint(checkpoint)
  return apiRequest<import('@/types/media').WorkflowCheckpoint>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/checkpoints/${normalized}/confirm`),
    { method: 'POST', body: { checkpoint: normalized } },
  )
}

export { listMediaJobSubtitlesApi } from './media'

/**
 * @deprecated Legacy W0 prototype route — unused in Media Studio UI. Backend does not implement this route.
 */
export function resumeWorkflowApi(workspaceId: string, jobId: string) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/workflow/resume`),
    { method: 'POST' },
  )
}

// ---------- proposals (extractive summary) ----------

/**
 * Script-first proposals (API_Contract: scriptContent + matched segments) carry
 * no plan body; derive the narrative view from them so every section shows its
 * script excerpt and source footage range, as the original narrative plan did.
 */
function scriptNarrativePlan(r: Record<string, unknown>, segments: unknown): NarrativePlan | null {
  const script = r.scriptContent ?? r.script_content
  if (typeof script !== 'string' || !script.trim() || !Array.isArray(segments)) return null
  const rows = segments
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, index) => ({
      seq: Number(s.seq ?? index + 1),
      startMs: Number(s.startMs ?? s.start_ms),
      endMs: Number(s.endMs ?? s.end_ms),
      excerpt: String(s.scriptExcerpt ?? s.script_excerpt ?? ''),
      note: (s.reasoningNote ?? s.reasoning_note ?? null) as string | null,
    }))
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .sort((a, b) => a.seq - b.seq)
  if (rows.length === 0) return null
  const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string') : []
  return {
    title: null,
    target_duration_ms: null,
    sections: rows.map((row, index) => ({
      seq: index + 1,
      heading: null,
      source_refs: [{ start_ms: row.startMs, end_ms: row.endMs }],
      script_source_lang: row.excerpt,
      beat_type: null,
      notes: row.note,
    })),
    global_reasoning_note: (r.reasoningNote ?? r.reasoning_note ?? null) as string | null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    warnings,
  }
}

/** Backend persists warnings as a JSON string array; the panel renders `{ code }` objects. */
function normalizeProposalWarnings(raw: unknown): unknown {
  if (!Array.isArray(raw)) return []
  return raw.map((w) => (typeof w === 'string' ? { code: w } : w))
}

function normalizeProposal(raw: unknown): MediaSummaryProposal {
  if (!raw || typeof raw !== 'object') return raw as MediaSummaryProposal
  const r = raw as Record<string, unknown>
  const cutRanges = (r.cut_ranges ?? r.segments ?? []) as any
  const derivedPlan = r.planBody ? null : scriptNarrativePlan(r, cutRanges)
  return {
    ...r,
    id: String(r.id || ''),
    proposal_index: (r.proposal_index ?? r.proposalIndex ?? null) as number | null,
    proposalIndex: (r.proposalIndex ?? r.proposal_index ?? null) as number | null,
    generated_by: String(r.generated_by ?? r.generatedBy ?? 'AI'),
    generatedBy: String(r.generatedBy ?? r.generated_by ?? 'AI'),
    generation_round: Number(r.generation_round ?? r.generationRound ?? 1),
    generationRound: Number(r.generationRound ?? r.generation_round ?? 1),
    archived_at: (r.archived_at ?? r.archivedAt ?? null) as string | null,
    archivedAt: (r.archivedAt ?? r.archived_at ?? null) as string | null,
    cut_ranges: cutRanges,
    segments: cutRanges,
    reasoning_note: (r.reasoning_note ?? r.reasoningNote ?? null) as string | null,
    reasoningNote: (r.reasoningNote ?? r.reasoning_note ?? null) as string | null,
    total_duration_ms: Number(r.total_duration_ms ?? r.totalDurationMs ?? 0),
    totalDurationMs: Number(r.totalDurationMs ?? r.total_duration_ms ?? 0),
    confidence: (r.confidence ?? null) as number | null,
    warnings: normalizeProposalWarnings(r.warnings),
    ...(derivedPlan ? { planBody: derivedPlan, planKind: 'NARRATIVE_PLAN' as const } : {}),
  }
}

export function listTransformationProposalsApi(workspaceId: string, jobId: string) {
  return apiRequest<MediaSummaryProposal[]>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/proposals`),
  ).then((items) => (items || []).map(normalizeProposal))
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
  ).then(normalizeProposal)
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
  ).then(normalizeProposal)
}

export function createSummaryLanguageApi(
  workspaceId: string,
  jobId: string,
  body: { targetLang: string; ttsVoiceId?: string | null },
) {
  return apiRequest<MediaJob>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/summary-languages`),
    { method: 'POST', body },
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
  body?: import('@/types/media').UpdateRenderConfigBody,
) {
  return apiRequest<MediaJob>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/rerun-render`),
    body === undefined ? { method: 'POST' } : { method: 'POST', body },
  )
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

// ---------- upload (chunked, API_Contract §4) ----------

type UploadSession = {
  uploadId: string
  chunkSizeBytes: number
  totalChunks: number
  receivedChunks: number
}

/** Chunks in flight at once: enough to fill the pipe without flooding the rate limit. */
const UPLOAD_CONCURRENCY = 3
/** Attempts per chunk for transient failures (network, 5xx, 429). */
const CHUNK_ATTEMPTS = 4
const CHUNK_RETRY_BASE_MS = 1000

function isTransientUploadError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500
  // fetch rejects with TypeError on network loss.
  return err instanceof TypeError
}

function abortError() {
  return new DOMException('Upload aborted', 'AbortError')
}

function waitOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Chunked upload: every request stays below the 10MB host-nginx body cap (and 100MB Cloudflare if proxied),
 * and each chunk carries its own (fresh) access token, so a long upload can no longer outlive
 * the token. Progress counts bytes on the wire (XHR upload events); 100% only after `complete` returns.
 */
export async function uploadTransformationMediaApi(
  workspaceId: string,
  projectId: string,
  file: File,
  options?: UploadMediaOptions | string,
): Promise<MediaUploadResponse> {
  const opts: UploadMediaOptions =
    typeof options === 'string' ? { name: options } : (options ?? {})
  if (opts.signal?.aborted) throw abortError()

  // One controller for the whole upload: the caller's abort or the first failed chunk stops every worker.
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const signal = controller.signal

  opts.onProgress?.(0)
  const session = await apiRequest<UploadSession>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/media/uploads`),
    {
      method: 'POST',
      body: { fileName: file.name, fileSizeBytes: file.size, contentType: file.type },
      signal,
    },
  )
  const sessionPath = buildWorkspacePath(workspaceId, `/media/uploads/${session.uploadId}`)

  const withRetry = async <T,>(send: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await send()
      } catch (err) {
        if (signal.aborted) throw abortError()
        if (attempt >= CHUNK_ATTEMPTS || !isTransientUploadError(err)) throw err
        await waitOrAbort(CHUNK_RETRY_BASE_MS * 2 ** (attempt - 1), signal)
      }
    }
  }

  // Bytes of finished chunks + bytes already sent of the chunks in flight, so the bar moves while
  // an 8MB chunk is on the wire instead of jumping once per chunk.
  let doneBytes = 0
  const inFlight = new Map<number, number>()
  let reported = 0
  const report = () => {
    let sent = doneBytes
    for (const loaded of inFlight.values()) sent += loaded
    // Cap at 99% — the server still probes and stores the file on `complete`. Never go backwards
    // (a retried chunk restarts from 0).
    const pct = Math.min(99, Math.floor((sent / Math.max(file.size, 1)) * 100))
    if (pct > reported) {
      reported = pct
      opts.onProgress?.(pct)
    }
  }

  const sendChunk = async (index: number) => {
    const start = index * session.chunkSizeBytes
    const blob = file.slice(start, Math.min(file.size, start + session.chunkSizeBytes))
    try {
      await withRetry(() => {
        inFlight.set(index, 0)
        return apiRequest(`${sessionPath}/chunks/${index}`, {
          method: 'PUT',
          body: blob,
          rawBody: true,
          headers: { 'Content-Type': 'application/octet-stream' },
          signal,
          onUploadProgress: (loaded) => {
            inFlight.set(index, Math.min(loaded, blob.size))
            report()
          },
        })
      })
    } finally {
      inFlight.delete(index)
    }
    doneBytes += blob.size
    report()
  }

  try {
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < session.totalChunks && !signal.aborted) {
        await sendChunk(nextIndex++)
      }
    }
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, session.totalChunks) }, () =>
      worker().catch((err) => {
        controller.abort()
        throw err
      }),
    )
    const results = await Promise.allSettled(workers)
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
    if (signal.aborted) throw abortError()

    // `complete` is idempotent server-side: a retry after a proxy/network timeout
    // waits for the running one and gets the same asset instead of losing it.
    const asset = await withRetry(() =>
      apiRequest<Record<string, unknown>>(`${sessionPath}/complete`, {
        method: 'POST',
        body: opts.name?.trim() ? { name: opts.name.trim() } : undefined,
        signal,
      }),
    )
    opts.onProgress?.(100)

    const assetId = String(asset.assetId ?? asset.id ?? '')
    return {
      ...asset,
      assetId,
      documentId: String(asset.documentId ?? assetId),
      fileName: String(asset.fileName ?? file.name),
      fileSizeBytes: typeof asset.fileSizeBytes === 'number' ? asset.fileSizeBytes : file.size,
      durationMs: typeof asset.durationMs === 'number' ? asset.durationMs : null,
      consented: Boolean(asset.consented),
    } as MediaUploadResponse
  } catch (err) {
    // Free the staged bytes and the per-user upload slot right away (best effort).
    void apiRequest(sessionPath, { method: 'DELETE' }).catch(() => undefined)
    throw err
  } finally {
    opts.signal?.removeEventListener('abort', onCallerAbort)
  }
}
