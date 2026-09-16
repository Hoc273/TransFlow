/**
 * CT10.3B — pure projections over the backend Availability Projection.
 *
 * Every function here reads the backend payload and nothing else. There is no
 * GPU, browser, deployment-name, worker-version, or cached inference, and no
 * effective-mode computation: the backend owns resolution.
 */
import type {
  AudioExecutionMode,
  AvailabilityProjection,
  ModeAvailability,
} from '@/types/transformation'

export const EXECUTION_MODE_REASON_PREFIX = 'media:executionMode.reason.'

export function modeAvailability(
  projection: AvailabilityProjection | undefined,
  mode: AudioExecutionMode,
): ModeAvailability | undefined {
  return projection?.availability?.[mode]
}

export function isModeAvailable(
  projection: AvailabilityProjection | undefined,
  mode: AudioExecutionMode,
): boolean {
  return modeAvailability(projection, mode)?.available === true
}

/**
 * Modes the selector may render, taken verbatim from the backend. Order follows
 * the deployment default first so the recommended choice reads first.
 */
export function selectableModes(
  projection: AvailabilityProjection | undefined,
): AudioExecutionMode[] {
  const supported = projection?.supportedExecutionModes ?? []
  const preferred = projection?.defaultExecutionMode
  if (!preferred || !supported.includes(preferred)) return [...supported]
  return [preferred, ...supported.filter((mode) => mode !== preferred)]
}

export type ModeBlock =
  | { kind: 'ok' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }

/** Why job creation is blocked for `mode`, if it is. */
export function modeBlock(
  projection: AvailabilityProjection | undefined,
  mode: AudioExecutionMode | null,
): ModeBlock {
  if (!projection || !mode) return { kind: 'loading' }
  const availability = modeAvailability(projection, mode)
  if (!availability?.available) {
    return { kind: 'unavailable', reason: availability?.unavailableReason ?? 'READINESS_UNKNOWN' }
  }
  return { kind: 'ok' }
}

/**
 * i18n key for a symbolic backend reason. Unknown codes fall back to the raw
 * string so a newly added backend code degrades to something readable rather
 * than blank — the FE stays a display layer with no business rules.
 */
export function reasonI18nKey(reason: string): string {
  return `${EXECUTION_MODE_REASON_PREFIX}${reason}`
}

export type PreCreateGuard =
  | { ok: true; requestedMode: AudioExecutionMode }
  | { ok: false; block: ModeBlock }

/**
 * Requirement 7 guard: always revalidate availability against a freshly
 * fetched projection before creating a job, and refuse rather than downgrade.
 *
 * `selected` may be null when the user never touched the selector; the
 * deployment default from the *fresh* projection is then the requested mode.
 */
export async function guardCreateWithFreshCapabilities(
  refresh: () => Promise<AvailabilityProjection | undefined>,
  selected: AudioExecutionMode | null,
): Promise<PreCreateGuard> {
  let fresh: AvailabilityProjection | undefined
  try {
    fresh = await refresh()
  } catch {
    fresh = undefined
  }
  if (!fresh) return { ok: false, block: { kind: 'loading' } }

  const requestedMode = selected ?? fresh.defaultExecutionMode
  const block = modeBlock(fresh, requestedMode)
  if (block.kind !== 'ok') return { ok: false, block }
  return { ok: true, requestedMode }
}
