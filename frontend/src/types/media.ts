import type { AudioExecutionMode } from '@/types/transformation'
import type { QaIssue } from '@/types/qa'

export type ProcessingMode = 'TRANSLATE_ONLY' | 'HYBRID'
export type SubtitleMode = 'HARD_SUB' | 'SOFT_SUB'
export type MediaRecipeId =
  | 'localization.full'
  | 'summary.extractive'
  | 'summary.generative'

/** 8 stage statuses (Q-M-B8). */
export type MediaStageStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'STALE'
  | 'SKIPPED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | string

/** 6 job aggregate statuses. */
export type MediaJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCELLED'
  | string

export type MediaStageName =
  | 'EXTRACT_AUDIO'
  | 'SOURCE_SEPARATION'
  | 'STT'
  | 'SUMMARIZE'
  | 'TRANSLATE'
  | 'TTS'
  | 'AUDIO_MIX'
  | 'RENDER'
  | string

export const MEDIA_ERROR_CODES = {
  STAGE_NOT_READY: '2902',
} as const

export type MediaAsset = {
  id: string
  projectId: string
  parentAssetId?: string | null
  assetType: string
  fileName: string
  mimeType: string
  fileSizeBytes: number
  durationMs: number | null
  processingStatus: string
  createdAt: string
  /** When the 3-day retention sweep deletes the stored files. */
  expiresAt?: string | null
  /** Set once the files were deleted; jobs on this video can no longer run or download. */
  purgedAt?: string | null
}

export type MediaUploadResponse = {
  documentId: string
  assetId: string
  fileName: string
  fileSizeBytes: number
  durationMs: number | null
  consented: boolean
}

export type RenderFailureReason = 'EMPTY_CUES' | 'DURATION_MISMATCH'

/** W3 additive — gate-computed duration diagnostics (docs/16 §7.5). */
export type RenderFailureDiagnostics = {
  durationMismatchKind?: 'GENERATIVE_TTS_TARGET' | 'LEGACY_SUBTITLE_TIMELINE' | string | null
  durationAuthority?: 'TTS' | 'SUBTITLE_TIMELINE' | string | null
  actualTtsDurationMs?: number | null
  targetDurationMs?: number | null
  expectedDurationMs?: number | null
  subtitleTimelineSpanMs?: number | null
  lastCueEndMs?: number | null
  missingTailMs?: number | null
  deltaMs?: number | null
  toleranceMs?: number | null
  videoDurationMs?: number | null
}

export type MediaJobStage = {
  id: string
  stageName: MediaStageName
  stageOrder: number
  status: MediaStageStatus
  progressPercent: number
  attemptCount?: number
  errorMessage?: string | null
  errorCode?: string | null
  errorDetail?: {
    title?: string | null
    message?: string | null
    retryable?: boolean | null
    recommendedAction?: string | null
    protocol?: string | null
    capability?: string | null
    model?: string | null
    /** PENDING stage waiting on an automatic retry: DEFERRED (same key, at retryAt) or FAILOVER (next key). */
    retry?: 'DEFERRED' | 'FAILOVER' | null
    retryAt?: string | null
    /** TTS stopped part-way: segments still without a voice clip (finished clips are kept). */
    missingSegments?: number | null
    totalSegments?: number | null
  } | null
  /** Storage ref bucket/key, not the original JSON output. */
  outputRef?: string | null
  startedAt: string | null
  completedAt: string | null
  /**
   * W3 additive — stable machine-readable RENDER gate failure reason
   * (EMPTY_CUES / DURATION_MISMATCH). Null for every non-gate failure.
   */
  failureReason?: RenderFailureReason | null
  /** W3 additive — gate-computed diagnostics; present only for DURATION_MISMATCH. */
  failureDiagnostics?: RenderFailureDiagnostics | null
}

/** Content Transformation domain phase (docs/36) — additive CT0. */
export type TransformationJobPhase =
  | 'DRAFT'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'MATERIALIZING'
  | 'COMPOSING'
  | 'PACKAGING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | string

/** Intent goal_type (docs/36) — additive CT0. */
export type TransformationGoalType =
  | 'LOCALIZE'
  | 'HIGHLIGHT_EXTRACTIVE'
  | 'SUMMARIZE_GENERATIVE'
  | 'REVIEW'
  | 'EDUCATE'
  | 'ADAPT'
  | 'CUSTOM'
  | string

export type MediaJob = {
  id: string
  documentId: string
  rootAssetId: string
  projectId?: string
  processingMode: ProcessingMode
  sourceLanguage: string | null
  targetLang: string
  status: MediaJobStatus
  subtitleMode: string
  requestedDurationSeconds: number | null
  selectedProposalId: string | null
  voiceId?: string | null
  /**
   * Phase B (V37) — authoritative TTS provider row id. Null for legacy jobs.
   * The pair (ttsProviderId, ttsVoiceId) is the runtime identity of a bound job;
   * the FE must never silently substitute the workspace default for a bound job.
   */
  ttsProviderId?: string | null
  /** Phase B (V37) — authoritative TTS voice row id. Null for legacy jobs. */
  ttsVoiceId?: string | null
  /** Phase C additive — display metadata of the bound TTS provider (nullable for legacy/dangling bindings). */
  ttsProviderName?: string | null
  /** Phase C additive — wire protocol of the bound TTS provider (e.g. `local_piper`). */
  ttsProviderProtocol?: string | null
  /** Phase C additive — language of the bound TTS voice row. */
  ttsVoiceLanguage?: string | null
  /** Phase C additive — gender of the bound TTS voice row. */
  ttsVoiceGender?: string | null
  /** Phase C additive — display name of the bound TTS voice row. */
  ttsVoiceDisplayName?: string | null
  translationJobId?: string | null
  createdAt: string
  stages: MediaJobStage[]
  /** CT0 additive — recipe catalog key, e.g. localization.full */
  recipeId?: string | null
  /** CT0 additive — Intent goal_type */
  goalType?: TransformationGoalType | null
  /** CT0 additive — domain lifecycle phase (not status) */
  domainPhase?: TransformationJobPhase | null
  /** CT1 additive — per-capability strategy snapshot */
  strategySnapshot?: Record<string, string> | null
  /** CT2 additive — active TransformationPlan kind */
  activePlanKind?: TransformationPlanKind | null
  /** CT2 additive — active plan status */
  activePlanStatus?: TransformationPlanStatus | null
  /**
   * W0 additive — effective workflow mode (docs/17 Q-M-WORKFLOW-01).
   * Null for legacy rows; the FE derives the recipe default via
   * `resolveWorkflowMode` (summary.* → MANUAL, localization.full → AUTO).
   */
  workflowMode?: WorkflowMode | null
  /** W0 additive — frozen workflow preset reference (display only; W1 resolution). */
  workflowPresetId?: string | null
  /** Frozen preset reference as returned by backend-main (`media_jobs.preset_id`). */
  presetId?: string | null
  /** W0 additive — pure checkpoint projection (docs/16 §7.5): CUT / REVIEW / EXPORT. */
  workflowCheckpoints?: WorkflowCheckpoint[] | null
}

export type WorkflowMode = 'MANUAL' | 'AUTO'

// ─── W1 workflow presets (docs/16 §7.5) ────────────────────────────────────

export type WorkflowPresetScope = 'SYSTEM' | 'WORKSPACE' | 'PROJECT'

/**
 * Canonical frozen preset config (W1, docs/16 §7.5 + preset config
 * extensions #1/#2). The backend is the authority — fields are read
 * defensively (config arrives as a JSON node).
 */
export type WorkflowPresetConfig = {
  schemaVersion?: number | null
  workflowMode?: WorkflowMode | null
  subtitleMode?: SubtitleMode | null
  /** Extension #1 — base render config (default BOTTOM when absent). */
  subtitlePosition?: SubtitlePosition | null
  /** Extension #1 — base render config (-30..30, default 0 when absent). */
  verticalOffsetPercent?: number | null
  /** Extension #1 — base render config (default true when absent). */
  backgroundBox?: boolean | null
  /** PRESET-VIZ (docs/97 §19.16) — text background color #RRGGBBAA (legacy path). */
  backgroundColor?: string | null
  /** PRESET-VIZ (docs/97 §19.16) v1.2 — text color #RRGGBB (legacy path). */
  textColor?: string | null
  /** OUTPUT-ASPECT (docs/97 §19.19) — output frame frozen at create; null = ORIGINAL. */
  outputAspectRatio?: OutputAspectRatio | null
  /** Extension #2 — authoritative TTS pair; both-or-nothing. */
  ttsProviderId?: string | null
  /** Extension #2 — authoritative TTS pair; both-or-nothing. */
  ttsVoiceId?: string | null
  presentation?: RenderPresentationConfig | null
}

/** Create/update body for workflow presets (W1 CRUD, docs/16 §7.5). */
export type WorkflowPresetRequest = {
  scope: WorkflowPresetScope
  name?: string
  description?: string | null
  config?: WorkflowPresetConfig
  schemaVersion?: number
  active?: boolean
  isDefault?: boolean
  projectId?: string | null
}

/** Public view of a workflow preset — mirror of WorkflowPresetResponse. */
export type WorkflowPreset = {
  id: string
  scope: WorkflowPresetScope
  workspaceId: string | null
  projectId: string | null
  name: string
  description: string | null
  config: WorkflowPresetConfig | null
  schemaVersion: number
  active: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type WorkflowCheckpointState =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SKIPPED'
  | 'BLOCKED'
  | 'COMPLETED'

export type WorkflowCheckpoint = {
  id: 'CUT' | 'REVIEW' | 'EXPORT' | string
  state: WorkflowCheckpointState
  canContinue: boolean
}

/** Subtitle cue returned by GET /api/workspaces/{wsId}/media/jobs/{jobId}/subtitles */
export type MediaSubtitleCue = {
  id: string
  seq: number
  contentSource?: string
  sourceText: string
  targetText: string
  startMs: number
  endMs: number
  ttsAudioRef?: string | null
}

export type SubtitlePosition = 'TOP' | 'CENTER' | 'BOTTOM'

// ─── Phase 2/6 presentation envelope (docs/16 §7.4) ─────────────────────────

export type SubtitleDisplayMode = 'SENTENCE' | 'PHRASE' | 'WORD' | 'CHARACTERS'

export type SubtitleTypographyOverride = {
  fontSize?: number | null
  bold?: boolean | null
  /**
   * V2 outline override subset (docs/97 §19.17 §B) — ring width 0..8.
   * 2026-09 dual-event: also renders above the background box (Layer 1
   * glyph outline over the Layer 0 yellow box); old workers are gated at
   * claim (SUBTITLE_BOX_OUTLINE).
   */
  outlineWidth?: number | null
  /** V2 outline override subset — #RRGGBB ring colour. */
  outlineColor?: string | null
}

// ─── V2 presentation layers (docs/97 §19.17 §B) ─────────────────────────────

export type PresentationLayerAnchor = 'SUBTITLE' | 'TOP' | 'CENTER' | 'BOTTOM'

export type PresentationLayerGeometry = {
  /** Semantic percent of the video width — 20..100. */
  widthPercent: number
  /** Semantic percent of the video height — 5..50. */
  heightPercent: number
  /** Optional horizontal center in frame-percent space — 0..100. */
  xPercent?: number | null
  /** Optional vertical center in frame-percent space — 0..100; absent follows anchor. */
  yPercent?: number | null
}

export type PresentationLayerType = 'SOLID' | 'BLUR'

/** Flat type-specific style — SOLID and BLUR key groups are XOR (fail-closed). */
export type SolidLayerStyle = {
  /** #RRGGBB cover colour; absent renders the historical black. */
  color?: string | null
  /** 0..100 — required for SOLID. */
  opacityPercent: number
}

export type BlurLayerStyle = {
  /** 2..20 — required for BLUR. */
  blurRadius: number
}

export type PresentationLayerStyle = SolidLayerStyle | BlurLayerStyle

export type PresentationLayer = {
  /** lowercase alphanumeric words joined by '-', ≤64 chars. */
  id: string
  type: PresentationLayerType
  enabled: boolean
  /** Ordering among layers; ties broken by id ASC (worker sorts zIndex ASC, id ASC). */
  zIndex: number
  anchor: PresentationLayerAnchor
  geometry: PresentationLayerGeometry
  style: PresentationLayerStyle
}

export type SubtitleMaskConfig = {
  enabled: boolean
  /** v1 fixed — the mask shares the subtitle anchor line. */
  anchor: 'SUBTITLE'
  widthPercent: number
  heightPercent: number
  opacityPercent: number
  paddingPercent: number
  /** PRESET-VIZ (docs/97 §19.16) — SOLID (drawbox) | BLUR (boxblur region). */
  style?: 'SOLID' | 'BLUR' | null
  /** PRESET-VIZ — 2..20, required when style=BLUR, forbidden for SOLID. */
  blurRadius?: number | null
  /** PRESET-VIZ — #RRGGBB cover color (default #000000). */
  color?: string | null
}

export type SubtitlePresentation = {
  schemaVersion: number
  displayMode: SubtitleDisplayMode
  wordsPerPhrase?: number | null
  /** W2 — CHARACTERS display mode only (10..80, required when displayMode=CHARACTERS). */
  maxCharactersPerCue?: number | null
  typography?: SubtitleTypographyOverride | null
  mask?: SubtitleMaskConfig | null
  /**
   * V2 presentation layers (docs/97 §19.17 §B) — authoritative burn overlays;
   * when non-empty the worker ignores the v1 mask field (no double-burn).
   * At most 4 entries.
   */
  layers?: PresentationLayer[] | null
}

export type AudioDuckingConfig = {
  enabled: boolean
  gainDb?: number | null
  attackMs?: number | null
  releaseMs?: number | null
}

export type AudioPresentation = {
  schemaVersion: number
  originalGainDb?: number | null
  ttsGainDb?: number | null
  ducking?: AudioDuckingConfig | null
  ttsTempo?: number | null
}

export type RenderPresentationConfig = {
  subtitle?: SubtitlePresentation | null
  audio?: AudioPresentation | null
}

/**
 * Backend-computed EFFECTIVE presentation projection (F-17/D6, docs/97
 * §19.17 §10) — the ONLY state the FE preview may mirror. Ownership is the
 * assigned snapshot flag plus the dead-control id list; `resolvedLinePercent`
 * is already clamped ([3..95]) and BOTTOM-locked to 88 when ownedByStyle
 * (F-07). Null only for legacy responses built before this field existed.
 */
export type EffectivePresentation = {
  /** True when an opaque background box is EFFECTIVE for this job. */
  boxMode: boolean
  /** True when an assigned SubtitleStyleSnapshot owns colors/font/background. */
  ownedByStyle: boolean
  /** Clamped subtitle anchor line [3..95]; 88 when ownedByStyle. */
  resolvedLinePercent: number
  /** Stable control ids FE must disable — guaranteed ineffective for this job. */
  deadControls: string[]
}

/** OUTPUT-ASPECT (docs/97 §19.19) — semantic output frames; ORIGINAL = no reframe. */
export type OutputAspectRatio = 'ORIGINAL' | '16:9' | '9:16' | '4:3' | '1:1'

export const OUTPUT_ASPECT_RATIOS: OutputAspectRatio[] = [
  'ORIGINAL',
  '16:9',
  '9:16',
  '4:3',
  '1:1',
]

export type RenderConfig = {
  subtitleMode: SubtitleMode
  subtitlePosition: SubtitlePosition
  verticalOffsetPercent: number
  backgroundBox: boolean
  confirmed: boolean
  sourceVideoUrl: string
  sourceVideoUrlExpiresInSeconds: number
  /** Phase 2/6 additive — canonical presentation envelope, null when none stored. */
  presentation?: RenderPresentationConfig | null
  /**
   * F-01 TRI-STATE on the PUT body (UpdateRenderConfigRequest): key absent =
   * KEEP stored · explicit null = CLEAR · "#RRGGBBAA" = validate & REPLACE.
   * Read-side it is simply the stored value or null.
   */
  backgroundColor?: string | null
  /** Tri-state as above — #RRGGBB text color (legacy burn path). */
  textColor?: string | null
  /** OUTPUT-ASPECT (docs/97 §19.19) — null/ORIGINAL keeps the source frame. */
  outputAspectRatio?: OutputAspectRatio | null
  /** Backend-computed effective projection — never recompute it from raw fields. */
  effective?: EffectivePresentation | null
}

/** F-01 tri-state directive for one render-config field on the PUT body. */
export type TriStateDirective<T> =
  | { op: 'keep' }
  | { op: 'clear' }
  | { op: 'replace'; value: T }

export type UpdateRenderConfigBody = Pick<
  RenderConfig,
  'subtitleMode' | 'subtitlePosition' | 'verticalOffsetPercent' | 'backgroundBox'
> & {
  /** Optional — absent preserves the stored envelope; present replaces it whole. */
  presentation?: RenderPresentationConfig | null
  /** Tri-state (F-01): absent=KEEP · null=CLEAR · #RRGGBBAA=REPLACE. */
  backgroundColor?: string | null
  /** Tri-state (F-01): absent=KEEP · null=CLEAR · #RRGGBB=REPLACE. */
  textColor?: string | null
  /** OUTPUT-ASPECT tri-state (docs/97 §19.19): absent=KEEP · null=CLEAR · value=REPLACE. */
  outputAspectRatio?: OutputAspectRatio | null
}

export type TransformationPlanStatus =
  | 'DRAFT'
  | 'CANDIDATE'
  | 'SELECTED'
  | 'SUPERSEDED'
  | 'ARCHIVED'
  | string

export type TransformationPlanKind =
  | 'CUT_PLAN'
  | 'IDENTITY_PLAN'
  | 'NARRATIVE_PLAN'
  | 'LESSON_PLAN'
  | 'STORYBOARD_PLAN'
  | 'ADAPTATION_PLAN'
  | string

export type CreateMediaJobBody = {
  documentId: string
  projectId?: string
  rootAssetId?: string
  fileName?: string
  /**
   * Preferred UL field (CT4.4 prep). First-party FE always sends this;
   * BE soft dual still accepts processingMode-only until CT4.4 hard.
   */
  recipeId?: MediaRecipeId | string | null
  /**
   * Legacy bridge — optional when recipeId is set. Do not send from FE after
   * CT4.4 prep (2026-07-24); reserved for external/legacy clients only.
   */
  processingMode?: ProcessingMode | null
  /** Optional STT language hint; omit to keep provider auto-detection. */
  sourceLang?: string | null
  targetLang: string
  subtitleMode?: SubtitleMode
  requestedDurationSeconds?: number | null
  /**
   * CT10.4: the mode the user explicitly asked for. The FE never computes or
   * sends an effective mode — resolution stays entirely in the backend
   * ExecutionDecision.
   */
  requestedMode?: AudioExecutionMode | null
  /**
   * Explicit TTS provider row id. Must be sent together with ttsVoiceId
   * (both or neither); the backend validates provider ownership and capability.
   */
  ttsProviderId?: string | null
  /**
   * Phase C — explicit TTS voice row id. Both or neither with ttsProviderId.
   * Must be null when `outputAudioMode == ORIGINAL_ONLY` (BE enforces).
   */
  ttsVoiceId?: string | null
  /** Explicitly skip TTS and keep the source audio. Defaults to false. */
  keepOriginalAudio?: boolean
  /**
   * W0 additive — workflow mode (docs/17 Q-M-WORKFLOW-01, docs/16 §7.5).
   * Optional; absent resolves the recipe-derived default (summary.* → MANUAL,
   * localization.full → AUTO).
   */
  workflowMode?: WorkflowMode | null
  /** W0 additive — frozen workflow preset reference (display only; W1 resolution). */
  workflowPresetId?: string | null
  /** Direct backend presetId alias (UUID) */
  presetId?: string | null
  /** Backend audio output mode (ORIGINAL_ONLY | DUB_REPLACE | DUB_MIX) */
  outputAudioMode?: string | null
  /** Reframe aspect ratio */
  aspectRatio?: string | null
  /**
   * Explicit opt-out of workflow preset default-resolution (create-form "no
   * preset" choice). True skips default resolution entirely — no
   * PROJECT/WORKSPACE/SYSTEM default applies and the job falls back to
   * recipe-derived defaults. Absent/false keeps resolution. An explicit
   * workflowPresetId always wins and ignores this flag.
   */
  skipPresetResolution?: boolean | null
  /** Optional flag to toggle VLM visual understanding for generative summary. */
  enableVlm?: boolean | null
}

export type CutRange = {
  startMs: number
  endMs: number
  start_ms?: number
  end_ms?: number
}

export type ProposalWarning = {
  code?: string
  message?: string
  severity?: string
}

export type NarrativeSourceRef = {
  start_ms: number
  end_ms: number
}

export type NarrativeSection = {
  seq: number
  heading: string | null
  source_refs: NarrativeSourceRef[]
  script_source_lang: string
  beat_type: string | null
  notes: string | null
}

export type NarrativePlan = {
  title: string | null
  target_duration_ms: number | null
  sections: NarrativeSection[]
  global_reasoning_note: string | null
  confidence: number | null
  warnings: string[]
}

export type MediaSummaryProposal = {
  id: string
  proposal_index?: number | null
  proposalIndex?: number | null
  generated_by: 'AI' | 'HUMAN' | string
  generatedBy?: 'AI' | 'HUMAN' | string
  generation_round: number
  generationRound?: number
  archived_at: string | null
  archivedAt?: string | null
  cut_ranges: CutRange[] | unknown
  segments?: Array<{ segmentIndex?: number; startMs: number; endMs: number }>
  reasoning_note: string | null
  reasoningNote?: string | null
  total_duration_ms: number
  totalDurationMs?: number
  confidence: number | null
  warnings: ProposalWarning[] | unknown
  /** CT2 additive — TransformationPlan status */
  planStatus?: TransformationPlanStatus | null
  /** CT2 additive — plan body kind */
  planKind?: TransformationPlanKind | null
  /** CT5.4a — NarrativePlanCodec wire shape; present only for NARRATIVE_PLAN. */
  planBody?: NarrativePlan | null
}

export type CreateCustomProposalBody = {
  cutRanges: Array<{ startMs: number; endMs: number }>
  reasoningNote?: string | null
}

export type UpdateCustomProposalBody = {
  cutRanges: Array<{ startMs: number; endMs: number }>
  reasoningNote?: string | null
}

export type MediaExportFormat = 'VIDEO' | 'SRT' | 'VTT'


export type MediaExportResponse = {
  format: MediaExportFormat | string
  fileName: string
  downloadUrl: string | null
  content: string | null
}

export type OverrideSourceLangBody = {
  sourceLang: string
}

/**
 * Phase C: explicit TTS provider + voice row ids, sent together to
 * `POST …/media/jobs/{jobId}/voice`. Both null = keep original
 * audio (TTS deselected, requires `outputAudioMode == ORIGINAL_ONLY`).
 * A partial pair must never be sent — the VoiceSelector only emits
 * all-or-nothing. The backend stores both IDs as the authoritative binding.
 */
export type SelectVoiceBody = {
  /** TTS provider row id (null = deselect / legacy voiceId-only flow). */
  providerId?: string | null
  /** TTS voice row id (null = deselect / legacy voiceId-only flow). */
  voiceId?: string | null
}

/** CT3 — technical OutputPackage (docs/36 §5.1). */
export type OutputPackage = {
  jobId: string
  primaryVideoRef: string | null
  primaryVideoDownloadUrl: string | null
  audioTracks: Array<{ role: string; storageRef: string | null }>
  subtitleTracks: Array<{ format: string; language: string; available: boolean }>
  durationMs: number | null
  checksumSha256: string | null
  artifactPins: string[]
}

/** CT3 — PublishPackage GENERIC draft (docs/36 §5.2). No social post in MVP. */
export type PublishPackage = {
  profile: 'GENERIC' | 'YOUTUBE' | 'TIKTOK' | 'DOUYIN' | string
  title: string | null
  description: string | null
  language: string | null
  tags: string[]
  thumbnailRef: string | null
  sourceJobId: string | null
  status: 'DRAFT' | 'READY' | 'PUBLISHED' | 'FAILED' | string
}

export type UpdatePublishPackageBody = {
  title?: string | null
  description?: string | null
  language?: string | null
  tags?: string[] | null
  thumbnailRef?: string | null
}

export type SegmentStatus = 'NEW' | 'TRANSLATED' | 'QA_FLAGGED' | 'APPROVED' | string

export type SegmentItem = {
  id: string
  seq: number
  sourceText: string
  targetText: string | null
  status: SegmentStatus
  tmScore?: number | null
  qaIssues: QaIssue[]
  /** Original video timeline (media segments) */
  startMs?: number | null
  endMs?: number | null
}

export type UpdateSegmentBody = {
  targetText: string
}

export type JobDetail = {
  id: string
  documentId?: string
  targetLang: string
  status: string
  providerUsed?: string | null
  modelUsed?: string | null
  segments: SegmentItem[]
}
