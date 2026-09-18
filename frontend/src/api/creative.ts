import { apiBaseUrl } from '@/config/featureFlags'
import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import { useAuthStore } from '@/store/authStore'

export type CreativeJobStatus =
  | 'PENDING'
  | 'WAITING_APPROVAL'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'

export type CreativeStageStatus =
  | 'PENDING'
  | 'WAITING_APPROVAL'
  | 'READY_TO_PROCESS'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STALE'
  | 'SKIPPED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'

export type OutputQuality = 'REAL' | 'SYNTHETIC' | 'DEGRADED'

export type CreativePipelineId = 'clip_factory' | 'animated_explainer' | 'documentary_montage'

export type CreativeWorkflowMode = 'GUIDED_TEAM' | 'QUICK_CREATOR'

export type CreativeJob = {
  id: string
  workspaceId: string
  projectId: string
  sourceDocumentId?: string | null
  pipelineId: string
  manifestVersion: string
  manifestContentHash?: string | null
  workflowMode: string
  status: string
  hardBudgetCapUsd: number
  reservedAmountUsd?: number | null
  spentAmountUsd?: number | null
  title?: string | null
  briefSummary?: string | null
  createdByUserId: string
  createdAt: string
  updatedAt: string
  cancelledAt?: string | null
  errorMessage?: string | null
  outputQuality?: string | null
  stages: CreativeStage[]
}

export type CreativeStage = {
  id: string
  productionJobId: string
  stageKey: string
  stageOrder: number
  unitIndex: number
  isVirtual?: boolean
  status: string
  progressPercent?: number | null
  errorMessage?: string | null
  correlationId?: string | null
  outputRef?: string | null
  attemptCount: number
  executionTimeMs?: number | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export type CreativeArtifact = {
  id: string
  productionJobId: string
  workspaceId: string
  artifactType: string
  logicalKey: string
  version: number
  status: string
  contentRef?: string | null
  contentHash?: string | null
  checksumSha256?: string | null
  fileSizeBytes?: number | null
  durationMs?: number | null
  width?: number | null
  height?: number | null
  codec?: string | null
  contentJson?: unknown
  createdAt: string
}

export type CreateCreativeJobBody = {
  projectId: string
  pipelineId: string
  /** Omitted → backend resolves the active manifest. */
  manifestVersion?: string
  workflowMode: string
  hardBudgetCapUsd: number
  title?: string
  briefSummary?: string
  sourceDocumentId?: string | null
}

export type ComposeScene = {
  id: string
  type: string
  voiceText: string
  templateId: string
  inputs?: Record<string, unknown>
  sfx?: string | null
}

export type ScriptRequest = {
  version: string
  renderer: string
  aspect: string
  scenes: ComposeScene[]
}

export type ComposeResult = {
  artifactId: string
  outputRef: string
  status: string
  durationMs: number
  checksum: string
  width: number
  height: number
}

export type IngestResult = {
  objectKey: string
  durationMs: number
  fileSize: number
  status: string
}

export type ClipFactoryClip = {
  artifactId: string
  logicalKey: string
  version: number
  contentRef: string
  durationMs: number
  checksum: string
}

export type ClipFactoryRunResult = {
  jobId: string
  exportedClips: number
  clips: ClipFactoryClip[]
  status: string
  idempotent?: boolean
}

export type CreativeClip = {
  id: string
  logicalKey: string
  version: number
  status: string
  contentRef: string
  checksum: string
  size: number
  durationMs: number
  width: number
  height: number
  lineage?: unknown
}

export type AnimatedExplainerBrief = {
  topic: string
  audience?: string
  tone?: string
  duration_seconds?: number
  language?: string
  brand?: Record<string, unknown>
  ttsProviderId?: string | null
  ttsVoiceId?: string | null
}

export type AnimatedExplainerRunResult = {
  jobId: string
  briefArtifactId: string
  researchArtifactId: string
  proposalArtifactId: string
  scriptArtifactId: string
  scenePlanArtifactId: string
  visualAssets: { assetId: string; objectKey: string; provenance: unknown }[]
  ttsDurations: Record<string, number>
  compositionArtifactId: string | null
  compositionRef: string | null
  jobStatus: string
}

export type RetryStageResult = {
  stageId: string
  status: string
  attemptCount: number
}

export function listCreativeJobsApi(workspaceId: string, projectId?: string) {
  const path = projectId
    ? buildWorkspacePath(workspaceId, `/production/jobs?projectId=${projectId}`)
    : buildWorkspacePath(workspaceId, `/production/jobs`)
  return apiRequest<CreativeJob[]>(path)
}

export function getCreativeJobApi(workspaceId: string, jobId: string) {
  return apiRequest<CreativeJob>(buildWorkspacePath(workspaceId, `/production/jobs/${jobId}`))
}

export function createCreativeJobApi(workspaceId: string, body: CreateCreativeJobBody, idempotencyKey: string) {
  return apiRequest<CreativeJob>(buildWorkspacePath(workspaceId, `/production/jobs`), {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}

export function cancelCreativeJobApi(workspaceId: string, jobId: string) {
  return apiRequest<CreativeJob>(buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/cancel`), {
    method: 'POST',
  })
}

export function retryCreativeStageApi(workspaceId: string, jobId: string, stageId: string) {
  return apiRequest<RetryStageResult>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/stages/${stageId}/retry`),
    { method: 'POST' },
  )
}

export function listCreativeArtifactsApi(workspaceId: string, jobId: string) {
  return apiRequest<CreativeArtifact[]>(buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/artifacts`))
}

export function composeCreativeJobApi(workspaceId: string, jobId: string, script: ScriptRequest, idempotencyKey: string) {
  return apiRequest<ComposeResult>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/compose`),
    { method: 'POST', body: script, headers: { 'Idempotency-Key': idempotencyKey } },
  )
}

/**
 * Multipart ingest upload with real progress (XHR).
 * Auth via the zustand token (never localStorage parsing); progress caps at
 * 99% while bytes are in flight — 100% only after the server responds
 * (MinIO write + duration probe still run after the upload body finishes).
 */
export function ingestCreativeVideoApi(
  workspaceId: string,
  jobId: string,
  file: File,
  idempotencyKey: string,
  onProgress?: (p: number) => void,
) {
  const path = buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/clip-factory/ingest`)
  const url = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`

  return new Promise<IngestResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.responseType = 'json'
    xhr.setRequestHeader('Accept', 'application/json')

    const token = useAuthStore.getState().accessToken
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Idempotency-Key', idempotencyKey)

    xhr.upload.onprogress = (e) => {
      if (!onProgress) return
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)))
      } else {
        onProgress(Math.min(95, Math.round((e.loaded / Math.max(file.size, 1)) * 100)))
      }
    }
    xhr.onload = () => {
      onProgress?.(100)
      const body = (xhr.response ?? parseJsonSafe(xhr.responseText)) as IngestResult
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body)
      } else {
        reject(normalizeXhrError(xhr, body))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

function parseJsonSafe(text: string): unknown {
  const t = text?.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t) as unknown
  } catch {
    return undefined
  }
}

function normalizeXhrError(xhr: XMLHttpRequest, body: unknown): Error {
  const b = body as { code?: string; message?: string } | undefined
  const code = typeof b?.code === 'string' ? b.code : ''
  const message = typeof b?.message === 'string' && b.message ? b.message : xhr.statusText || 'Upload failed'
  const err = new Error(code ? `${code}: ${message}` : message)
  ;(err as { status?: number }).status = xhr.status
  return err
}

export const MAX_CREATIVE_BYTES = 500 * 1024 * 1024 // 500MB (ClipFactoryController)
export const MAX_CREATIVE_DURATION_MS = 30 * 60 * 1000 // 30 min

export function runClipFactoryApi(workspaceId: string, jobId: string, clipCount: number, idempotencyKey: string) {
  return apiRequest<ClipFactoryRunResult>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/clip-factory/run`),
    { method: 'POST', body: { clipCount }, headers: { 'Idempotency-Key': idempotencyKey } },
  )
}

export function listCreativeClipsApi(workspaceId: string, jobId: string) {
  return apiRequest<CreativeClip[]>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/clip-factory/clips`),
  )
}

// ── CP2 Animated Explainer (DAG L1) ──────────────────────────────────────
// NOTE: the backend exposes only POST /run and POST /research for the
// explainer — there is no GET assets endpoint, so visual assets are read
// from the run response plus the generic artifacts list (TTS_AUDIO:*,
// SCENE_PLAN, SCRIPT, RESEARCH, BRIEF logical keys).

export function runAnimatedExplainerE2EApi(
  workspaceId: string,
  jobId: string,
  brief: AnimatedExplainerBrief,
  idempotencyKey: string,
) {
  return apiRequest<AnimatedExplainerRunResult>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/animated-explainer/run`),
    { method: 'POST', body: { brief }, headers: { 'Idempotency-Key': idempotencyKey } },
  )
}

export function researchAnimatedExplainerApi(
  workspaceId: string,
  jobId: string,
  brief: AnimatedExplainerBrief,
  idempotencyKey: string,
) {
  return apiRequest<AnimatedExplainerRunResult>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/animated-explainer/research`),
    { method: 'POST', body: brief, headers: { 'Idempotency-Key': idempotencyKey } },
  )
}

// ── Storage preview/download (presigned) ─────────────────────────────────
// POST storage-url resolves a short-lived presigned GET URL for a job-scoped
// object ref (artifact contentRef, visual objectKey, clip contentRef…).
// The backend rejects keys outside the job's creative/{jobId}/ namespace.

export type CreativeStorageUrl = {
  url: string
  expiresInSeconds: number
}

export function creativeStorageUrlApi(workspaceId: string, jobId: string, objectKey: string) {
  return apiRequest<CreativeStorageUrl>(
    buildWorkspacePath(workspaceId, `/production/jobs/${jobId}/storage-url`),
    { method: 'POST', body: { objectKey } },
  )
}
