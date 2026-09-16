/**
 * CT10.3B — client mirror of the read-only Availability Projection
 * (`GET /api/transformation/capabilities`, docs/68 §3).
 *
 * The FE treats this payload as the single source of truth for which audio
 * execution modes may be offered. It never derives availability from GPU,
 * browser, deployment name, worker version, or a cached assumption, and it
 * never computes an effective mode — only the user's requested mode is sent.
 */

export type AudioExecutionMode = 'FAST' | 'STUDIO'

export type WorkerCapabilityState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | string

/**
 * Symbolic, backend-owned reason codes. Kept as a widened string union so a new
 * backend code renders verbatim instead of breaking the build or showing blank.
 */
export type ModeUnavailableReason =
  | 'PRODUCT_UNSUPPORTED'
  | 'POLICY_DISABLED'
  | 'READINESS_UNKNOWN'
  | 'WORKER_CAPABILITY_UNKNOWN'
  | 'WORKER_CAPABILITY_UNAVAILABLE'
  | 'WORKER_CAPABILITY_MISMATCH'
  | (string & {})

export type ModeAvailability = {
  available: boolean
  unavailableReason: ModeUnavailableReason | null
}

export type WorkerCapabilitySummary = {
  state: WorkerCapabilityState
  workerCount: number
  compatibleFastWorkers: number
  compatibleStudioWorkers: number
}

export type ReadinessSummary = {
  status: string
  readyExecutionModes: AudioExecutionMode[]
  reasons: string[]
  evaluatedAt: string | null
}

export type AvailabilityProjection = {
  protocolVersion: string
  supportedExecutionModes: AudioExecutionMode[]
  defaultExecutionMode: AudioExecutionMode
  availability: Partial<Record<AudioExecutionMode, ModeAvailability>>
  workerCapability: WorkerCapabilitySummary
  readiness: ReadinessSummary
}
