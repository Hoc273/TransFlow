import type { ComposeScene, CreativeArtifact, CreativeJob, CreativeStage } from '@/api/creative'

export const CREATIVE_JOB_STATUSES = [
  'PENDING',
  'WAITING_APPROVAL',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
] as const

export const CREATIVE_STAGE_STATUSES = [
  'PENDING',
  'WAITING_APPROVAL',
  'READY_TO_PROCESS',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'STALE',
  'SKIPPED',
  'CANCEL_REQUESTED',
  'CANCELLED',
] as const

const TERMINAL_JOB = new Set(['COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'])

/** Job is still in flight (or asked to cancel) — keep polling. */
export function isActiveCreativeJobStatus(status: string | undefined | null): boolean {
  const s = String(status ?? '').toUpperCase()
  return !TERMINAL_JOB.has(s)
}

/**
 * Whether any stage is still in flight (non-terminal).
 * Terminal = COMPLETED | FAILED | SKIPPED | CANCELLED. STALE is excluded —
 * STALE is a stable state awaiting user action, with no background progress.
 */
export function hasActiveCreativeStages(job: Pick<CreativeJob, 'stages'> | null | undefined): boolean {
  if (!job?.stages?.length) return false
  return job.stages.some((s) => {
    const st = String(s.status ?? '').toUpperCase()
    return st === 'PENDING' || st === 'WAITING_APPROVAL' || st === 'READY_TO_PROCESS' || st === 'PROCESSING' || st === 'CANCEL_REQUESTED'
  })
}

export function isCancellableCreativeJob(job: CreativeJob | null | undefined): boolean {
  if (!job) return false
  const s = String(job.status ?? '').toUpperCase()
  return s !== 'COMPLETED' && s !== 'PARTIALLY_FAILED' && s !== 'FAILED' && s !== 'CANCELLED' && s !== 'CANCEL_REQUESTED'
}

export function orderedCreativeStages(job: CreativeJob | null | undefined): CreativeStage[] {
  if (!job?.stages?.length) return []
  return [...job.stages].sort((a, b) => a.stageOrder - b.stageOrder || a.unitIndex - b.unitIndex)
}

/** Deepest in-flight stage, else the last stage. */
export function currentCreativeStage(job: CreativeJob | null | undefined): CreativeStage | null {
  const stages = orderedCreativeStages(job)
  if (stages.length === 0) return null
  const active = stages.find((s) => {
    const st = String(s.status).toUpperCase()
    return st === 'PROCESSING' || st === 'CANCEL_REQUESTED' || st === 'READY_TO_PROCESS' || st === 'STALE' || st === 'WAITING_APPROVAL' || st === 'PENDING'
  })
  return active ?? stages[stages.length - 1] ?? null
}

export function overallCreativeProgress(job: CreativeJob | null | undefined): number {
  if (!job?.stages?.length) return 0
  const stages = job.stages
  const weight = 100 / stages.length
  let total = 0
  for (const s of stages) {
    const st = String(s.status).toUpperCase()
    if (st === 'COMPLETED' || st === 'SKIPPED') total += weight
    else if (st === 'PROCESSING' || st === 'CANCEL_REQUESTED' || st === 'READY_TO_PROCESS') {
      total += (weight * Math.min(100, Math.max(0, s.progressPercent ?? 0))) / 100
    } else if (st === 'FAILED' || st === 'CANCELLED') {
      total += (weight * Math.min(100, Math.max(0, s.progressPercent ?? 0))) / 100
    }
  }
  return Math.round(Math.min(100, Math.max(0, total)))
}

export function pipelineLabelKey(pipelineId: string | undefined | null): string {
  const p = String(pipelineId ?? '')
  if (p === 'clip_factory' || p === 'animated_explainer' || p === 'documentary_montage') return `pipeline.${p}`
  return 'pipeline.clip_factory'
}

export function qualityBadgeClass(quality: string | undefined | null): string {
  const q = String(quality ?? 'REAL').toUpperCase()
  if (q === 'DEGRADED') return 'status-badge-failed'
  if (q === 'SYNTHETIC') return 'status-badge-partial'
  return 'status-badge-completed'
}

export function formatUsd(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '$0'
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const s = Math.max(0, ms) / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rest = (s - m * 60).toFixed(0).padStart(2, '0')
  return `${m}:${rest}`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Display flow: friendly pipeline stages ───────────────────────────────
// The board renders the stages the backend materialized for THIS job (manifest
// snapshot), grouped: the VISUAL_GEN fan-out shows as one node with the
// virtual parent aggregating its children.

export type CreativeFlowNode = {
  key: string
  label: string
  statuses: string[]
  progress: number | null
  attempt: number
  error: string | null
  stageIds: string[]
  childTotal: number | null
  childDone: number | null
}

const ACTIVE_STAGE = new Set(['PENDING', 'WAITING_APPROVAL', 'READY_TO_PROCESS', 'PROCESSING', 'CANCEL_REQUESTED'])

function stageProgress(s: CreativeStage): number {
  const st = String(s.status).toUpperCase()
  if (st === 'COMPLETED' || st === 'SKIPPED') return 100
  return Math.min(100, Math.max(0, s.progressPercent ?? 0))
}

/** Group a job's stages into display nodes (virtual VISUAL_GEN parent + children collapse). */
export function creativeFlowNodes(job: CreativeJob | null | undefined): CreativeFlowNode[] {
  const stages = orderedCreativeStages(job)
  const nodes: CreativeFlowNode[] = []
  let i = 0
  while (i < stages.length) {
    const s = stages[i]
    if (s.stageKey === 'VISUAL_GEN' && s.isVirtual) {
      const children = stages.filter((x) => x.stageKey === 'VISUAL_GEN' && !x.isVirtual)
      const done = children.filter((x) => {
        const st = String(x.status).toUpperCase()
        return st === 'COMPLETED' || st === 'SKIPPED'
      }).length
      const parent = s
      const statuses = [String(parent.status).toUpperCase(), ...children.map((x) => String(x.status).toUpperCase())]
      const failed = statuses.includes('FAILED')
      const aggregate = children.length > 0 ? Math.round((done / children.length) * 100) : stageProgress(parent)
      nodes.push({
        key: s.stageKey,
        label: s.stageKey,
        statuses,
        progress: failed ? null : aggregate,
        attempt: Math.max(parent.attemptCount, ...children.map((x) => x.attemptCount), 0),
        error: parent.errorMessage ?? children.find((x) => x.errorMessage)?.errorMessage ?? null,
        stageIds: [parent.id, ...children.map((x) => x.id)],
        childTotal: children.length || null,
        childDone: children.length ? done : null,
      })
      i += 1 + children.length
      continue
    }
    nodes.push({
      key: s.stageKey,
      label: s.stageKey,
      statuses: [String(s.status).toUpperCase()],
      progress: ACTIVE_STAGE.has(String(s.status).toUpperCase()) || String(s.status).toUpperCase() === 'COMPLETED' ? stageProgress(s) : null,
      attempt: s.attemptCount,
      error: s.errorMessage ?? null,
      stageIds: [s.id],
      childTotal: null,
      childDone: null,
    })
    i += 1
  }
  return nodes
}

/** Status driving a flow node's visual state (worst wins). */
export function flowNodeState(node: CreativeFlowNode): 'failed' | 'processing' | 'done' | 'skipped' | 'stale' | 'cancelled' | 'waiting' | 'pending' {
  const S = node.statuses
  if (S.includes('FAILED')) return 'failed'
  if (S.includes('PROCESSING')) return 'processing'
  if (S.includes('CANCEL_REQUESTED')) return 'cancelled'
  if (S.includes('STALE')) return 'stale'
  if (S.includes('WAITING_APPROVAL')) return 'waiting'
  if (S.every((s) => s === 'COMPLETED')) return 'done'
  if (S.every((s) => s === 'SKIPPED' || s === 'COMPLETED')) return 'skipped'
  if (S.includes('CANCELLED')) return 'cancelled'
  return 'pending'
}

// ── Artifacts ────────────────────────────────────────────────────────────

export function latestArtifactByLogicalKey(
  artifacts: CreativeArtifact[],
  logicalKey: string,
): CreativeArtifact | null {
  return artifacts.find((a) => a.logicalKey === logicalKey) ?? null
}

export function latestVideoArtifact(artifacts: CreativeArtifact[]): CreativeArtifact | null {
  return artifacts.find((a) => a.artifactType === 'VIDEO' || a.logicalKey === 'VIDEO') ?? null
}

/**
 * Extract the executable script from an artifact's contentJson. The VIDEO
 * artifact persists the full ScriptRequest used for the render; the SCRIPT
 * artifact stores the same shape plus provenance.
 */
export function scriptFromArtifact(contentJson: unknown): { version: string; aspect: string; scenes: ComposeScene[] } | null {
  if (!contentJson || typeof contentJson !== 'object') return null
  const c = contentJson as Record<string, unknown>
  const scenes = Array.isArray(c.scenes) ? (c.scenes as ComposeScene[]) : null
  if (!scenes || scenes.length === 0) return null
  return {
    version: typeof c.version === 'string' ? c.version : '1.0.0',
    aspect: typeof c.aspect === 'string' ? c.aspect : '9:16',
    scenes: scenes.filter((s) => s && typeof s === 'object' && typeof s.voiceText === 'string'),
  }
}

/** Strip a bucket-qualified ref ("transflow-creative/…") down to the object key. */
export function objectKeyFromRef(ref: string | null | undefined): string {
  const r = String(ref ?? '').trim()
  const slash = r.indexOf('/')
  if (/^(transflow-[a-z-]+)\//.test(r)) return r.slice(slash + 1)
  return r
}

export type ArtifactFileKind = 'video' | 'audio' | 'image' | 'data'

export function artifactFileKind(a: CreativeArtifact): ArtifactFileKind {
  const k = `${a.artifactType ?? ''} ${a.logicalKey ?? ''}`.toUpperCase()
  if (a.codec || k.includes('VIDEO') || k.includes('MP4')) return 'video'
  if (k.includes('TTS_AUDIO') || k.includes('AUDIO')) return 'audio'
  if (a.width && a.height && !a.codec) return 'image'
  return 'data'
}

/** Human label for a logical key: TTS_AUDIO:scene-01 → "TTS audio · scene-01". */
export function logicalKeyLabelParts(logicalKey: string): { base: string; suffix: string | null } {
  const idx = logicalKey.indexOf(':')
  if (idx === -1) return { base: logicalKey, suffix: null }
  return { base: logicalKey.slice(0, idx), suffix: logicalKey.slice(idx + 1) }
}

/** Extract numeric rank scores + reasons from a clip's lineage payload (defensive — shape is worker-owned). */
export function clipScoreInfo(lineage: unknown): { scores: { label: string; value: number }[]; total: number | null; reasons: string[] } {
  const out = { scores: [] as { label: string; value: number }[], total: null as number | null, reasons: [] as string[] }
  if (!lineage || typeof lineage !== 'object') return out
  const l = lineage as Record<string, unknown>
  const rank = (l.rank && typeof l.rank === 'object' ? l.rank : {}) as Record<string, unknown>
  const candidateScores = (l.scores ?? rank.scores) as Record<string, unknown> | undefined
  if (candidateScores && typeof candidateScores === 'object') {
    for (const [k, v] of Object.entries(candidateScores)) {
      if (typeof v === 'number' && Number.isFinite(v)) out.scores.push({ label: k, value: v })
    }
  }
  const total = (l.total ?? rank.total) as unknown
  if (typeof total === 'number' && Number.isFinite(total)) out.total = total
  const reasons = (l.reasons ?? rank.reasons) as unknown
  if (Array.isArray(reasons)) out.reasons = reasons.filter((r): r is string => typeof r === 'string').slice(0, 5)
  return out
}

/** Map an error to a stable i18n code when the backend sends a known one. */
const KNOWN_ERROR_CODES = new Set([
  'BUDGET_HARD_CAP',
  'PRICING_ROW_MISSING',
  'SCRIPT_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'JOB_TERMINAL',
  'STAGE_NOT_FAILED',
  'NON_RETRYABLE_FAILURE',
  'MAX_RETRY_EXCEEDED',
  'PIPELINE_MISMATCH',
  'RIGHTS_BLOCKED',
  'QUALITY_BLOCKED',
  'MAX_CLIPS_PER_JOB_EXCEEDED',
  'PRODUCTION_JOB_NOT_FOUND',
  'STORAGE_KEY_FORBIDDEN',
])

export function creativeErrorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e) {
    const c = String((e as { code?: unknown }).code ?? '')
    if (KNOWN_ERROR_CODES.has(c)) return c
  }
  const msg = e instanceof Error ? e.message : String(e ?? '')
  const m = msg.match(/^([A-Z][A-Z0-9_]{4,}):/)
  return m && KNOWN_ERROR_CODES.has(m[1]) ? m[1] : null
}

export function creativeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e ?? 'Unknown error')
}
