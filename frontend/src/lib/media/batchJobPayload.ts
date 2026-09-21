/**
 * Batch Localization v1 — pure payload + orchestration helpers.
 *
 * Batch v1 is a frontend-only coordinator on top of the single-job backend
 * contract (`POST /transformation/jobs`): there is deliberately NO batch
 * backend endpoint and NO pipeline change. Every job in a batch is created
 * through the same invariants as a single create (consent, preset
 * resolution/freeze, execution mode, TTS binding, EXTRACT_AUDIO dispatch).
 *
 * Supported shapes (localization.full only):
 * - N videos → 1 language: one shared voice config for the whole batch
 *   (same targetLang ⇒ one compatible pair fits every video).
 * - 1 video → N languages: one explicit voice pair PER target language
 *   (a preset voice pair can never fit every language, and JOB explicit
 *   fields win over the preset at `bindTtsProviderAndVoice`).
 * - N videos × N languages is out of scope for v1 (cartesian explosion).
 *
 * Cost note (accepted for v1): each job materializes and runs its own
 * pipeline, so 1→N re-runs EXTRACT_AUDIO + STT per language. Shared source
 * preprocessing is a separate v2 task — never fold it in here.
 */
import type { CreateMediaJobBody, WorkflowMode } from '@/types/media'
import type { AudioExecutionMode } from '@/types/transformation'
import type { VoiceSelection } from '@/lib/media/voiceSelection'

/** Batch v1 fan-out cap: at most this many upload/consent/create requests in flight. */
export const BATCH_CONCURRENCY = 3

/**
 * One row's create payload input — the same fields as the single-create
 * `CreateJobSelection`, minus the submit deps (kept in the component so this
 * module stays pure and unit-testable without mocks).
 */
export type LocalizationJobPayloadInput = {
  documentId: string
  projectId?: string
  /** Batch v1 only supports 'localization.full'. */
  recipeId: string
  sourceLang?: string
  targetLang: string
  /** W0 additive — workflow mode; absent lets the backend derive the recipe default. */
  workflowMode?: WorkflowMode
  /** M-C — optional workflow preset id; the backend resolves/validates/freezes. */
  workflowPresetId?: string
  requestedDurationSeconds: number | null
  requestedMode: AudioExecutionMode | null
  /** Phase C — provider + voice chosen at create (all-or-nothing). */
  voiceSelection: VoiceSelection
  /** Explicit source-audio choice (batch-global); false/absent keeps the dubbed default. */
  keepOriginalAudio?: boolean
  /**
   * C2 — the selected AUTO preset carries its own voice pair. When true the
   * FE sends NO explicit pair (null/null) so the preset pair wins at
   * `bindTtsProviderAndVoice`. Multi-target dubbed batches MUST pass false
   * here and send an explicit pair per target language instead — a preset
   * pair cannot be compatible with every language.
   */
  presetProvidesVoice?: boolean
  enableVlm?: boolean
}

/**
 * Exact create-mutation body (identical shape to the single-create
 * `CreateJobApiInput` — the component aliases that type to this one so the
 * two can never drift apart).
 */
export type LocalizationCreateBody = {
  documentId: string
  projectId?: string
  recipeId: string
  sourceLang?: string
  targetLang: string
  workflowMode?: WorkflowMode
  workflowPresetId?: string | null
  /** Explicit "no preset" opt-out — skips backend default resolution. */
  skipPresetResolution?: boolean | null
  requestedDurationSeconds: number | null
  requestedMode: AudioExecutionMode | null
  ttsProviderId?: string | null
  ttsVoiceId?: string | null
  keepOriginalAudio?: boolean
  enableVlm?: boolean | null
}

/**
 * Build the exact create-job body for one batch row.
 *
 * Mirrors the single-create invariants byte-for-byte:
 * - provider+voice must be sent together or neither — a partial pair throws
 *   (the backend rejects it with 422 regardless);
 * - `keepOriginalAudio` forces null/null (the backend rejects any TTS pair
 *   combined with it);
 * - a preset-provided voice pair forces null/null so the backend applies the
 *   preset pair (JOB explicit fields would otherwise win over the preset);
 * - picker "no preset" (workflowPresetId null/undefined) opts OUT of backend
 *   default resolution (skipPresetResolution: true).
 */
export function buildLocalizationCreateJobInput(
  input: LocalizationJobPayloadInput,
): LocalizationCreateBody {
  const { voiceSelection } = input
  const hasProvider = voiceSelection.providerId != null
  const hasVoice = voiceSelection.voiceId != null
  const voiceDeferred = input.recipeId === 'summary.generative'
  const presetBindsVoice = input.presetProvidesVoice === true
  if (input.keepOriginalAudio !== true
      && !voiceDeferred
      && !presetBindsVoice
      && hasProvider !== hasVoice) {
    throw new Error('partial TTS binding: provider and voice must be sent together')
  }
  const sendPair = input.keepOriginalAudio !== true
    && !presetBindsVoice
    && hasProvider
    && hasVoice
  return {
    documentId: input.documentId,
    projectId: input.projectId,
    recipeId: input.recipeId,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    workflowMode: input.workflowMode,
    workflowPresetId: input.workflowPresetId ?? null,
    skipPresetResolution: input.workflowPresetId == null,
    requestedDurationSeconds: input.requestedDurationSeconds,
    requestedMode: input.requestedMode,
    ttsProviderId: sendPair ? voiceSelection.providerId : null,
    ttsVoiceId: sendPair ? voiceSelection.voiceId : null,
    keepOriginalAudio: input.keepOriginalAudio === true,
    enableVlm: input.enableVlm,
  }
}

/**
 * Pure mapping from the create-mutation input to the exact HTTP body.
 * Every workflow field the FE may send MUST be forwarded verbatim; the
 * backend owns resolution/validation/freeze.
 *
 * C2: subtitleMode is NO LONGER sent from the create form — the backend
 * resolves it.
 */
export function createJobApiBody(body: LocalizationCreateBody): CreateMediaJobBody {
  return {
    documentId: body.documentId,
    projectId: body.projectId,
    recipeId: body.recipeId,
    sourceLang: body.sourceLang,
    targetLang: body.targetLang,
    workflowMode: body.workflowMode,
    workflowPresetId: body.workflowPresetId,
    skipPresetResolution: body.skipPresetResolution,
    requestedDurationSeconds: body.requestedDurationSeconds,
    requestedMode: body.requestedMode,
    ttsProviderId: body.ttsProviderId,
    ttsVoiceId: body.ttsVoiceId,
    keepOriginalAudio: body.keepOriginalAudio,
    enableVlm: body.enableVlm,
  }
}

/**
 * Phase C — create-time voice gate. Create is always dubbed: the request must
 * carry a COMPLETE provider+voice pair. Any missing half blocks submission.
 * C2: a preset-provided voice pair satisfies the gate (the FE sends no pair
 * and the backend binds the preset pair).
 */
export function createVoiceGate(
  recipeId: string,
  voiceSelection: VoiceSelection,
  presetProvidesVoice = false,
): 'ok' | 'missing-voice-pair' {
  if (recipeId === 'summary.generative') return 'ok' // voice deferred to render prep
  if (presetProvidesVoice) return 'ok'
  if (voiceSelection.providerId == null || voiceSelection.voiceId == null) {
    return 'missing-voice-pair'
  }
  return 'ok'
}

/**
 * Run `fn` over `items` with at most `limit` promises in flight.
 * Results preserve input order. A rejection in `fn` rejects the whole run —
 * batch callers catch per-item inside `fn` and return a status object instead
 * (partial failure must never abort sibling items).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workerCount = Math.min(Math.max(limit, 1), items.length)
  if (workerCount === 0) return results
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
