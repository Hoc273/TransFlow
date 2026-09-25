import type {
  MediaJob,
  MediaJobStage,
  MediaRecipeId,
  MediaStageName,
  MediaStageStatus,
  MediaSummaryProposal,
  NarrativePlan,
  TransformationJobPhase,
  TransformationPlanKind,
  TransformationPlanStatus,
  MediaSubtitleCue,
  WorkflowCheckpoint,
  SegmentItem,
} from '@/types/media'
import type { QaIssue } from '@/types/qa'
import { issueBlockingActions } from '@/lib/qa'
import { ApiError } from '@/types/api'

/**
 * Preset admin milestone — FE-friendly mapping for the create-job fail-closed
 * preset voice language mismatch (WORKFLOW_PRESET_VOICE_LANG_MISMATCH, 422).
 * Returns the i18n key to surface, or null when the error is not this code so
 * callers fall back to the raw message / generic error (never show a backend
 * exception for this code).
 */
export function presetVoiceLangMismatchKey(e: unknown): string | null {
  if (e instanceof ApiError && e.code === 'WORKFLOW_PRESET_VOICE_LANG_MISMATCH') {
    return 'media:workflowPreset.voiceLangMismatch'
  }
  return null
}

/** UI interaction / badge state for a proposal card (runtime-aligned). */
export type ProposalSelectionUiState = 'candidate' | 'selected' | 'activated' | 'activating'

/** Studio plan-panel kind derived from recipe (not processingMode). */
export type RecipePlanPanelKind = 'trim' | 'cut_plan' | 'narrative_plan'

/**
 * API stage list sorted by stageOrder (supports legacy 6-stage + new 8-stage jobs).
 *
 * Fail-closed: when the API returns no stages this returns [] — stage status is
 * API-owned, the UI never invents PENDING/SKIPPED placeholders. Callers render
 * an explicit no-data state instead.
 */
export function orderedMediaStages(
  job: Pick<MediaJob, 'stages'> | null | undefined,
): MediaJobStage[] {
  const existing = job?.stages ?? []
  if (existing.length === 0) return []
  return [...existing].sort((a, b) => (a.stageOrder ?? 0) - (b.stageOrder ?? 0))
}

export const MEDIA_STAGE_STATUSES: MediaStageStatus[] = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'STALE',
  'SKIPPED',
  'CANCEL_REQUESTED',
  'CANCELLED',
]

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024 // 500MB (Q-M-C12)
export const MAX_MEDIA_DURATION_MS = 30 * 60 * 1000 // 30 min

export function isTerminalMediaJobStatus(status: string | undefined | null): boolean {
  const s = String(status ?? '').toUpperCase()
  return s === 'COMPLETED' || s === 'FAILED' || s === 'PARTIALLY_FAILED' || s === 'CANCELLED'
}

/**
 * The domain-phase badge duplicates the job StatusBadge when the job is
 * terminal and the phase label matches the status (COMPLETED/FAILED/CANCELLED).
 * Intermediate phases (UNDERSTANDING/PLANNING/…) still add information while
 * the job runs — only the redundant terminal badge is hidden.
 */
export function isRedundantPhaseBadge(
  job: { status?: string | null; domainPhase?: string | null } | null | undefined,
): boolean {
  if (!job || !job.domainPhase) return false
  const status = String(job.status ?? '').toUpperCase()
  const phase = String(job.domainPhase).toUpperCase()
  if (phase !== 'COMPLETED' && phase !== 'FAILED' && phase !== 'CANCELLED') return false
  return status === phase
}

export function isActiveMediaJobStatus(status: string | undefined | null): boolean {
  const s = String(status ?? '').toUpperCase()
  return s === 'PENDING' || s === 'PROCESSING'
}

/**
 * Whether any stage of a media job is still in flight (non-terminal).
 *
 * Stage statuses mirror `MediaStageRetryPolicy.isFinal` (backend): terminal =
 * COMPLETED | FAILED | SKIPPED | CANCELLED; in-flight = PENDING | PROCESSING |
 * CANCEL_REQUESTED. STALE is intentionally excluded — STALE is a stable state
 * awaiting user action (rerun), with no background progression to poll for.
 *
 * Used together with `isActiveMediaJobStatus` to keep polling after a rerun
 * (rerunTtsRender / rerunSummarize) when the job itself is already COMPLETED
 * but stages are PENDING/PROCESSING again.
 */
export function hasActiveMediaStages(
  job: Pick<MediaJob, 'stages'> | null | undefined,
): boolean {
  if (!job?.stages?.length) return false
  return job.stages.some((s) => {
    const st = String(s.status ?? '').toUpperCase()
    return st === 'PENDING' || st === 'PROCESSING' || st === 'CANCEL_REQUESTED'
  })
}

export function isCancellableMediaJob(job: MediaJob | undefined | null): boolean {
  if (!job) return false
  if (isTerminalMediaJobStatus(job.status)) return false
  return job.stages.some((s) => {
    const st = String(s.status).toUpperCase()
    return st === 'PENDING' || st === 'PROCESSING' || st === 'STALE' || st === 'CANCEL_REQUESTED'
  })
}

/**
 * CT4.4+ — recipe-first read path (docs/38).
 *
 * TODO(recipe-migration): The `processingMode` fallbacks below (in
 * `resolveRecipeId` and `isExtractiveRecipe`) exist ONLY for legacy database
 * compatibility — older rows may persist `processingMode='HYBRID'` without a
 * `recipeId`. Once the CT4.4 (or equivalent) recipe migration backfills
 * `recipeId` on every existing media job and the backend guarantees
 * `recipeId` is always present, these fallbacks MUST be removed. Do not branch
 * new UI/logic on `processingMode` — use `recipeId` / `planKind` only.
 *
 * Prefer `recipeId`; fall back to legacy `processingMode` bridge for older
 * responses that might omit additive CT0 fields.
 * UI branching must use recipeId / planKind — not processingMode alone
 * (generative jobs persist HYBRID as a DB placeholder).
 */
export function resolveRecipeId(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): string | null {
  if (!job) return null
  if (job.recipeId === 'summary.script_match') return 'summary.generative'
  if (job.recipeId) return job.recipeId
  if (job.processingMode === 'HYBRID') return 'summary.extractive'
  if (job.processingMode === 'TRANSLATE_ONLY') return 'localization.full'
  return null
}

/** True when job is bound to extractive highlight recipe. */
export function isExtractiveRecipe(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): boolean {
  const id = resolveRecipeId(job)
  if (id === 'summary.extractive') return true
  if (id === 'localization.full' || id === 'summary.generative') return false
  // Legacy rows without recipeId: HYBRID maps to extractive only.
  return job?.processingMode === 'HYBRID'
}

export function isGenerativeRecipe(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): boolean {
  return resolveRecipeId(job) === 'summary.generative'
}

/**
 * Single-plan generative (new write path): planning strategy
 * SUMMARY_SINGLE_PLAN (or absent snapshot for forward-compat). Auto-commits,
 * never waits for selection.
 */
export function isSinglePlanGenerativeJob(
  job: Pick<MediaJob, 'recipeId' | 'processingMode' | 'strategySnapshot'> | null | undefined,
): boolean {
  if (!isGenerativeRecipe(job)) return false
  const planning =
    (job as { strategySnapshot?: Record<string, string> | null })?.strategySnapshot?.planning
  return planning == null || planning === 'SUMMARY_SINGLE_PLAN'
}

/**
 * Legacy Narrative Review job (already persisted with planning=NARRATIVE_REVIEW):
 * keeps the old selection-gate read path so completed-but-unselected jobs don't dead-end.
 */
export function isLegacyNarrativeReviewJob(
  job: Pick<MediaJob, 'recipeId' | 'processingMode' | 'strategySnapshot'> | null | undefined,
): boolean {
  if (!isGenerativeRecipe(job)) return false
  return (
    (job as { strategySnapshot?: Record<string, string> | null })?.strategySnapshot?.planning ===
    'NARRATIVE_REVIEW'
  )
}

export function isLocalizationRecipe(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): boolean {
  return resolveRecipeId(job) === 'localization.full'
}

/**
 * W0 — effective workflow mode (docs/17 Q-M-WORKFLOW-01). Explicit job value
 * wins; legacy rows (workflowMode null) derive the recipe default
 * (summary.* → MANUAL, localization.full → AUTO).
 */
export function resolveWorkflowMode(
  job: Pick<MediaJob, 'recipeId' | 'processingMode' | 'workflowMode'> | null | undefined,
): 'MANUAL' | 'AUTO' {
  if (job?.workflowMode === 'MANUAL' || job?.workflowMode === 'AUTO') return job.workflowMode
  const id = resolveRecipeId(job)
  if (id && id.startsWith('summary.')) return 'MANUAL'
  return 'AUTO'
}

/**
 * C2 (docs/97 §19.14, docs/15 §5.6): CP-B render-confirmation scope = EVERY
 * MANUAL job — any recipe, any subtitle mode (generative, extractive,
 * localization HARD_SUB or SOFT_SUB). AUTO jobs freeze at create and never
 * confirm. Mirrors WorkflowPolicyRegistry.requiresRenderConfirmation.
 */
export function isRenderConfirmationRecipe(
  job: Pick<MediaJob, 'recipeId' | 'processingMode' | 'workflowMode' | 'subtitleMode'> | null | undefined,
): boolean {
  return resolveWorkflowMode(job) === 'MANUAL'
}

/** Convert a raw backend subtitle cue to a SegmentItem with attached QA issues */
export function subtitleToSegmentItem(sub: MediaSubtitleCue, qaIssues: QaIssue[] = []): SegmentItem {
  return {
    id: sub.id,
    seq: sub.seq,
    sourceText: sub.sourceText ?? '',
    targetText: sub.targetText ?? '',
    status: 'APPROVED',
    tmScore: null,
    startMs: sub.startMs,
    endMs: sub.endMs,
    qaIssues: qaIssues.filter((q) => q.subtitleSegmentId === sub.id),
  }
}

export function checkpointOf(
  job:
    | (Pick<MediaJob, 'workflowCheckpoints'> &
        Partial<Pick<MediaJob, 'stages' | 'workflowMode' | 'recipeId' | 'processingMode'>>)
    | null
    | undefined,
  id: string,
): WorkflowCheckpoint | null {
  const existing = job?.workflowCheckpoints?.find((c) => c.id === id)
  if (existing) return existing

  // When BE does not explicitly project workflowCheckpoints, derive from job.stages:
  const mode =
    job?.workflowMode === 'MANUAL' || job?.workflowMode === 'AUTO'
      ? job.workflowMode
      : job?.recipeId?.startsWith('summary.')
        ? 'MANUAL'
        : 'AUTO'
  const stages = job?.stages ?? []
  if (stages.length === 0) return null

  const stageMap = new Map(stages.map((s) => [s.stageName, s]))

  if (id === 'CUT') {
    if (mode === 'AUTO') {
      return { id: 'CUT', state: 'SKIPPED', canContinue: false }
    }
    const summarize = stageMap.get('SUMMARIZE')
    const translate = stageMap.get('TRANSLATE')
    const isConfirmed = translate?.status === 'COMPLETED' || translate?.status === 'PROCESSING'
    if (isConfirmed) {
      return { id: 'CUT', state: 'CONFIRMED', canContinue: false }
    }
    const canCont = summarize?.status === 'COMPLETED' && translate?.status === 'PENDING'
    return { id: 'CUT', state: canCont ? 'PENDING' : 'SKIPPED', canContinue: canCont }
  }

  if (id === 'REVIEW') {
    if (mode === 'AUTO') {
      return { id: 'REVIEW', state: 'SKIPPED', canContinue: false }
    }
    const translate = stageMap.get('TRANSLATE')
    const tts = stageMap.get('TTS')
    const isConfirmed = tts?.status === 'COMPLETED' || tts?.status === 'PROCESSING'
    if (isConfirmed) {
      return { id: 'REVIEW', state: 'CONFIRMED', canContinue: false }
    }
    const isTranslateDone = translate?.status === 'COMPLETED'
    return {
      id: 'REVIEW',
      state: isTranslateDone ? 'PENDING' : 'SKIPPED',
      canContinue: isTranslateDone && tts?.status === 'PENDING',
    }
  }

  if (id === 'EXPORT') {
    const render = stageMap.get('RENDER')
    const isRenderDone = render?.status === 'COMPLETED'
    return {
      id: 'EXPORT',
      state: isRenderDone ? 'CONFIRMED' : 'PENDING',
      canContinue: isRenderDone,
    }
  }

  return null
}

/** W0 — true when the CUT checkpoint can be continued by the user right now. */
export function canContinueCut(
  job:
    | (Pick<MediaJob, 'workflowCheckpoints'> &
        Partial<Pick<MediaJob, 'stages' | 'workflowMode' | 'recipeId' | 'processingMode'>>)
    | null
    | undefined,
): boolean {
  return checkpointOf(job, 'CUT')?.canContinue === true
}

/** W0 — true when the REVIEW checkpoint is gate-blocked (QA resume available). */
export function isReviewBlocked(
  job:
    | (Pick<MediaJob, 'workflowCheckpoints'> &
        Partial<Pick<MediaJob, 'stages' | 'workflowMode' | 'recipeId' | 'processingMode'>>)
    | null
    | undefined,
): boolean {
  return checkpointOf(job, 'REVIEW')?.state === 'BLOCKED'
}

/** Extractive or generative — both pause after SUMMARIZE for plan selection. */
export function isSummaryRecipe(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): boolean {
  return isExtractiveRecipe(job) || isGenerativeRecipe(job)
}

/**
 * Which plan panel UX to show. Driven by recipeId (with processingMode fallback).
 * Do not branch UI on processingMode alone — generative also stores HYBRID.
 */
export function recipePlanPanelKind(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): RecipePlanPanelKind {
  if (isGenerativeRecipe(job)) return 'narrative_plan'
  if (isExtractiveRecipe(job)) return 'cut_plan'
  return 'trim'
}

export function recipeLabelKey(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): 'modeTranslateOnly' | 'modeHybrid' | 'modeGenerative' {
  if (isGenerativeRecipe(job)) return 'modeGenerative'
  return isExtractiveRecipe(job) ? 'modeHybrid' : 'modeTranslateOnly'
}

/**
 * Resolve plan kind for a proposal row.
 * Prefer persisted planKind; fall back to recipe inference for pre-CT5 rows.
 */
export function resolveProposalPlanKind(
  proposal: Pick<MediaSummaryProposal, 'planKind'> | null | undefined,
  job?: Pick<MediaJob, 'recipeId' | 'processingMode'> | null,
): TransformationPlanKind | null {
  if (proposal?.planKind) return proposal.planKind
  if (!job) return null
  if (isGenerativeRecipe(job)) return 'NARRATIVE_PLAN'
  if (isExtractiveRecipe(job)) return 'CUT_PLAN'
  if (isLocalizationRecipe(job)) return 'IDENTITY_PLAN'
  return null
}

export function isNarrativeProposal(
  proposal: Pick<MediaSummaryProposal, 'planKind' | 'planBody'>,
): proposal is Pick<MediaSummaryProposal, 'planKind'> & { planBody: NarrativePlan } {
  return proposal.planKind === 'NARRATIVE_PLAN' && proposal.planBody != null
}

export function isCutPlanProposal(
  proposal: Pick<MediaSummaryProposal, 'planKind' | 'planBody'>,
  job?: Pick<MediaJob, 'recipeId' | 'processingMode'> | null,
): boolean {
  if (isNarrativeProposal(proposal)) return false
  const kind = resolveProposalPlanKind(proposal, job)
  return kind === 'CUT_PLAN' || kind === 'IDENTITY_PLAN' || kind == null
}

/**
 * HITL SELECT_PLAN gate (runtime): extractive summary + SUMMARIZE COMPLETED + no selection,
 * plus legacy NARRATIVE_REVIEW generative jobs (completed but unselected before deploy).
 * Single-plan generative auto-commits (no selection pause), so it never awaits.
 * Note: domainPhase PLANNING also covers SUMMARIZE PROCESSING — UI only awaits
 * selection after proposals exist (SUMMARIZE COMPLETED).
 */
export function isAwaitingPlanSelection(
  job: Pick<
    MediaJob,
    'recipeId' | 'processingMode' | 'selectedProposalId' | 'stages' | 'domainPhase' | 'strategySnapshot'
  > | null | undefined,
): boolean {
  if (!job || !isSummaryRecipe(job)) return false
  if (isSinglePlanGenerativeJob(job)) return false
  if (job.selectedProposalId) return false
  const summarize = job.stages?.find((s) => s.stageName === 'SUMMARIZE')
  return (
    summarize != null && String(summarize.status).toUpperCase() === 'COMPLETED'
  )
}

/**
 * After select, runtime immediately activates (activate / activateNarrative).
 * FE locks selection to prevent duplicate select → re-activate.
 */
export function isProposalSelectionLocked(
  job: Pick<MediaJob, 'selectedProposalId'> | null | undefined,
): boolean {
  return Boolean(job?.selectedProposalId)
}

/**
 * Whether activation has progressed past mere selection storage.
 * Runtime: select sets selectedProposalId then runs activate* (translation job / stages).
 */
export function isSelectedProposalActivated(
  job: Pick<MediaJob, 'selectedProposalId' | 'translationJobId' | 'stages' | 'domainPhase'> | null | undefined,
): boolean {
  if (!job?.selectedProposalId) return false
  if (job.translationJobId) return true
  const phase = String(job.domainPhase ?? '').toUpperCase()
  if (
    phase === 'MATERIALIZING' ||
    phase === 'COMPOSING' ||
    phase === 'PACKAGING' ||
    phase === 'COMPLETED'
  ) {
    return true
  }
  const translate = job.stages?.find((s) => s.stageName === 'TRANSLATE')
  if (!translate) return false
  const st = String(translate.status).toUpperCase()
  return (
    st === 'PROCESSING' ||
    st === 'COMPLETED' ||
    st === 'FAILED' ||
    st === 'STALE' ||
    st === 'CANCEL_REQUESTED' ||
    st === 'CANCELLED' ||
    // PENDING after select means activate already queued translate
    st === 'PENDING'
  )
}

/**
 * Card-level UI state for a proposal.
 * - candidate: not selected
 * - selected: this proposal is selected (badge)
 * - activated: selected and pipeline activation progressed
 *
 * Note: non-selected cards are non-interactive when
 * `isProposalSelectionLocked(job)` is true.
 */
export function resolveProposalSelectionUiState(
  job: Pick<
    MediaJob,
    'selectedProposalId' | 'translationJobId' | 'stages' | 'domainPhase'
  > | null | undefined,
  proposalId: string,
): ProposalSelectionUiState {
  if (!job?.selectedProposalId || job.selectedProposalId !== proposalId) {
    return 'candidate'
  }
  if (isSelectedProposalActivated(job)) return 'activated'
  return 'selected'
}

/**
 * Resolve planStatus for display. Prefer API planStatus; mirror BE
 * TransformationPlanSupport.resolveStatus when missing.
 */
export function resolvePlanStatus(
  proposal: Pick<MediaSummaryProposal, 'id' | 'planStatus' | 'archived_at' | 'generated_by'>,
  selectedProposalId: string | null | undefined,
): TransformationPlanStatus {
  if (proposal.planStatus) return proposal.planStatus
  if (proposal.archived_at) return 'ARCHIVED'
  if (selectedProposalId && selectedProposalId === proposal.id) return 'SELECTED'
  if (String(proposal.generated_by).toUpperCase() === 'HUMAN') return 'DRAFT'
  return 'CANDIDATE'
}

/** i18n key under media:domainPhase.* for backend JobPhase (no invented phases). */
export function domainPhaseLabelKey(
  phase: TransformationJobPhase | string | null | undefined,
): string {
  const p = String(phase ?? '').toUpperCase()
  switch (p) {
    case 'DRAFT':
      return 'domainPhase.DRAFT'
    case 'UNDERSTANDING':
      return 'domainPhase.UNDERSTANDING'
    case 'PLANNING':
      return 'domainPhase.PLANNING'
    case 'MATERIALIZING':
      return 'domainPhase.MATERIALIZING'
    case 'COMPOSING':
      return 'domainPhase.COMPOSING'
    case 'PACKAGING':
      return 'domainPhase.PACKAGING'
    case 'COMPLETED':
      return 'domainPhase.COMPLETED'
    case 'FAILED':
      return 'domainPhase.FAILED'
    case 'CANCELLED':
      return 'domainPhase.CANCELLED'
    default:
      return 'domainPhase.unknown'
  }
}

export function isNarrativeFeatureDisabledError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: unknown; message?: unknown }
  return value.status === 400
    && typeof value.message === 'string'
    && value.message.includes('summary.generative')
    && value.message.toLowerCase().includes('disabled')
}

export function requestedDurationForRecipe(
  recipeId: MediaRecipeId,
  durationSeconds: number | null,
): number | null {
  return recipeId === 'localization.full' ? null : durationSeconds
}

/**
 * CSS class for `.media-mode-badge` — maps recipe → style tokens.
 * Generative uses the summary (HYBRID) visual token; SoT label is still recipe.
 */
export function recipeModeBadgeClass(
  job: Pick<MediaJob, 'recipeId' | 'processingMode'> | null | undefined,
): 'HYBRID' | 'TRANSLATE_ONLY' | 'GENERATIVE' {
  if (isGenerativeRecipe(job)) return 'GENERATIVE'
  return isExtractiveRecipe(job) ? 'HYBRID' : 'TRANSLATE_ONLY'
}

/**
 * Resolves the effective domain phase for display.
 * Maps terminal job statuses (COMPLETED/FAILED/CANCELLED) directly.
 * For active jobs, derives the phase from the current active stage
 * (UNDERSTANDING -> PLANNING -> MATERIALIZING -> COMPOSING) so that
 * UI does not show stale or misleading phases.
 */
export function resolveEffectivePhase(
  job: Pick<MediaJob, 'status' | 'domainPhase' | 'stages'> | null | undefined,
): TransformationJobPhase | string | null {
  if (!job) return null
  const status = String(job.status ?? '').toUpperCase()
  if (status === 'COMPLETED') return 'COMPLETED'
  if (status === 'FAILED') return 'FAILED'
  if (status === 'CANCELLED') return 'CANCELLED'

  if (job.stages?.length) {
    const sorted = [...job.stages].sort((a, b) => a.stageOrder - b.stageOrder)
    const active = sorted.find((s) => {
      const st = String(s.status).toUpperCase()
      return st === 'PROCESSING' || st === 'CANCEL_REQUESTED' || st === 'STALE' || st === 'PENDING'
    })
    if (active) {
      switch (active.stageName) {
        case 'EXTRACT_AUDIO':
        case 'SOURCE_SEPARATION':
        case 'STT':
          return 'UNDERSTANDING'
        case 'SUMMARIZE':
          return 'PLANNING'
        case 'TRANSLATE':
        case 'TTS':
          return 'MATERIALIZING'
        case 'AUDIO_MIX':
        case 'RENDER':
          return 'COMPOSING'
      }
    }
  }

  return job.domainPhase ?? null
}

export function currentStage(job: MediaJob | undefined | null): MediaJobStage | null {
  if (!job?.stages?.length) return null
  const sorted = [...job.stages].sort((a, b) => a.stageOrder - b.stageOrder)
  const active = sorted.find((s) => {
    const st = String(s.status).toUpperCase()
    return st === 'PROCESSING' || st === 'CANCEL_REQUESTED' || st === 'STALE' || st === 'PENDING'
  })
  if (active) return active
  return sorted[sorted.length - 1] ?? null
}

export function stageByName(
  job: MediaJob | undefined | null,
  name: MediaStageName,
): MediaJobStage | null {
  return job?.stages?.find((s) => s.stageName === name) ?? null
}

export function overallProgress(job: MediaJob | undefined | null): number {
  if (!job) return 0
  const status = String(job.status ?? '').toUpperCase()
  if (status === 'COMPLETED') return 100
  if (!job.stages?.length) return 0

  // Only executable stages (stages that are not SKIPPED) represent pipeline work.
  const activeStages = job.stages.filter(
    (s) => String(s.status).toUpperCase() !== 'SKIPPED',
  )
  if (activeStages.length === 0) {
    return status === 'COMPLETED' ? 100 : 0
  }

  const weight = 100 / activeStages.length
  let total = 0
  for (const s of activeStages) {
    const st = String(s.status).toUpperCase()
    if (st === 'COMPLETED') {
      total += weight
    } else if (st === 'PROCESSING' || st === 'CANCEL_REQUESTED') {
      const pct = Math.min(100, Math.max(0, s.progressPercent ?? 0))
      total += (weight * pct) / 100
    } else if (st === 'FAILED' || st === 'CANCELLED') {
      total += (weight * Math.min(100, Math.max(0, s.progressPercent ?? 0))) / 100
    }
  }
  return Math.round(Math.min(100, Math.max(0, total)))
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function parseMmSs(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const parts = trimmed.split(':').map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

export function secondsToMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function validateMediaFile(file: File): string | null {
  if (file.size > MAX_MEDIA_BYTES) {
    return 'FILE_TOO_LARGE'
  }
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi)$/i.test(file.name)) {
    return 'INVALID_TYPE'
  }
  return null
}

/** Client-side effective_block for EXPORT (mirrors 06b / BE gate). */
export function hasEffectiveBlockExport(issues: QaIssue[] | undefined | null): boolean {
  if (!issues?.length) return false
  return issues.some((issue) => {
    if (issue.resolved) return false
    const actions = issueBlockingActions(issue)
    if (!actions.includes('BLOCK_EXPORT')) return false
    const overridden = issue.overrides?.some((o) => o.blockingAction === 'BLOCK_EXPORT')
    return !overridden
  })
}

export function hasEffectiveBlockRender(issues: QaIssue[] | undefined | null): boolean {
  if (!issues?.length) return false
  return issues.some((issue) => {
    if (issue.resolved) return false
    const actions = issueBlockingActions(issue)
    if (!actions.includes('BLOCK_RENDER')) return false
    const overridden = issue.overrides?.some((o) => o.blockingAction === 'BLOCK_RENDER')
    return !overridden
  })
}

/** Backend stage errorCode while RENDER is held by unresolved BLOCK_RENDER QA issues. */
export const QA_BLOCKED = 'QA_BLOCKED'

/**
 * RENDER is PENDING and the dispatcher recorded that QA holds it. Backend-owned
 * (docs/API_Contract): never inferred from issue lists, which may still be loading.
 */
export function isRenderWaitingForQa(job: Pick<MediaJob, 'stages'> | null | undefined): boolean {
  return !!job?.stages?.some(
    (s) =>
      s.stageName === 'RENDER' &&
      String(s.status).toUpperCase() === 'PENDING' &&
      s.errorCode === QA_BLOCKED,
  )
}

/** Open issues that currently block rendering (not resolved, BLOCK_RENDER not overridden). */
export function renderBlockingIssues(issues: QaIssue[] | undefined | null): QaIssue[] {
  return (issues ?? []).filter((issue) => hasEffectiveBlockRender([issue]))
}

export function normalizeCutRanges(raw: unknown): Array<{ startMs: number; endMs: number }> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => {
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      const startMs = Number(o.startMs ?? o.start_ms ?? 0)
      const endMs = Number(o.endMs ?? o.end_ms ?? 0)
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
      return { startMs, endMs }
    })
    .filter((x): x is { startMs: number; endMs: number } => x != null)
}

export function normalizeWarnings(
  raw: unknown,
): Array<{ code?: string; message?: string; severity?: string }> {
  if (!Array.isArray(raw)) return []
  return raw.filter((w) => w && typeof w === 'object') as Array<{
    code?: string
    message?: string
    severity?: string
  }>
}

export function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
