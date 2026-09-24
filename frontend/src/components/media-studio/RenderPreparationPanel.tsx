// @ts-nocheck
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  IconDeviceFloppy,
  IconLoader2,
  IconLock,
  IconPlayerPlay,
  IconRefresh,
  IconRocket,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import {
  useConfirmRender,
  useRenderConfig,
  useRerunRender,
  useSelectVoice,
  useUpdateRenderConfig,
} from '@/hooks/useMedia'
import { useVoicePreview } from '@/hooks/useProviders'
import { deriveStyleAssignment, useJobSubtitleStyle } from '@/hooks/useSubtitleStyle'
import {
  applyTypographyToEnvelope,
  colorDirective,
  typographyPatch,
} from '@/lib/media/renderConfig'
import {
  DEFAULT_PREVIEW_FONT_SIZE,
  PLAY_RES_Y,
  clampOverlayCenterPercent,
  projectEffectivePreview,
  projectLayers,
  snapSubtitlePlacement,
  subtitleAnchorLinePercent,
  type EffectivePreviewSource,
  type PreviewOverlay,
} from '@/lib/media/previewProjection'
import {
  defaultCoverLayer,
  hydrateCoverState,
  toWireLayers,
} from '@/lib/media/coverLayers'
import { CoverLayersEditor } from '@/components/media-studio/CoverLayersEditor'
import { cn } from '@/lib/cn'
import { isGenerativeRecipe, isRenderConfirmationRecipe, isSummaryRecipe, resolveWorkflowMode } from '@/lib/media'
import { ApiError } from '@/types/api'
import type {
  MediaJob,
  OutputAspectRatio,
  PresentationLayer,
  RenderPresentationConfig,
  SubtitleDisplayMode,
  SubtitleMode,
  SubtitlePosition,
  TriStateDirective,
} from '@/types/media'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

type Props = {
  workspaceId: string
  job: MediaJob
  provider?: ProviderConfig
  voices: TtsVoice[]
  canEdit: boolean
  /**
   * M-A aggregation: when embedded in RenderAndVoiceSection the section's own
   * VoiceSelector is the single voice surface — this panel's voice grid
   * (cards + preview) is suppressed. Standalone usage (non-localization
   * render-preparation panel) keeps the grid.
   */
  hideVoiceGrid?: boolean
  /**
   * Finish & Render aggregation: when the section hosts the audio controls in
   * its own row, the panel reads the shared values from `audio` and never
   * renders its own audio section. Standalone usage keeps the internal state.
   */
  audio?: AudioPresentationValues
  onAudioChange?: (next: AudioPresentationValues) => void
  /**
   * §1.8.2 redesign: the section's VoiceSelector rendered as config group ①
   * (slot) — the panel provides the numbered shell. Standalone keeps the
   * internal grid.
   */
  voiceSlot?: ReactNode
}

/**
 * M-A (docs/19 §1.8.2): AUTO jobs freeze the render configuration at create —
 * the panel is force-locked from the workflow mode, so a TTS FAILED/CANCELLED
 * retry window can NEVER unlock an AUTO job into an editable dead-end (AUTO
 * has no confirm path; PUT/confirm are rejected server-side for AUTO).
 * MANUAL keeps the historical unlock rule (re-edit/re-confirm after TTS failure).
 */
function isRenderPrepLocked(job: MediaJob, confirmed: boolean, autoFrozen: boolean): boolean {
  if (autoFrozen) return true
  const tts = job.stages.find((s) => s.stageName === 'TTS')
  const status = String(tts?.status ?? '').toUpperCase()
  // Allow re-edit / re-confirm after TTS failure (mirrors BE isTtsRetryable).
  if (status === 'FAILED' || status === 'CANCELLED') return false
  if (confirmed) return true
  // After confirm, TTS moves PENDING → PROCESSING → COMPLETED.
  return status === 'PROCESSING' || status === 'COMPLETED' || status === 'STALE'
}

// ─── Phase 6 presentation draft + payload builder (docs/16 §7.4, 19 §1.8.1) ──

export type RenderPresentationDraft = {
  subtitleMode: SubtitleMode
  displayMode: SubtitleDisplayMode
  wordsPerPhrase: number
  maxCharactersPerCue: number
  fontSize: number | null
  bold: boolean | null
  outlineWidth?: number | null
  outlineColor?: string | null
  /**
   * V2 cover layers (docs/97 §19.17 §B — user decision 2026-09-06): editors
   * ALWAYS emit the authoritative `layers` array and never write the legacy v1
   * `mask` again (the validator rejects the two together; the worker ignores
   * the mask when layers exist). A stored v1 mask is converted into the
   * equivalent single SUBTITLE layer on hydration.
   */
  coverEnabled: boolean
  coverLayers: PresentationLayer[]
  originalGainDb: number
  ttsGainDb: number
  duckingEnabled: boolean
  duckingGainDb: number
  ttsTempo: number
}

/**
 * M-B (docs/16 §7.4, W2 validation contract): CHARACTERS requires an integer
 * 10..80. The backend is the validation authority — this helper only drives
 * the FE validation state (never invented as a backend fallback). Other modes
 * are never validated for maxCharactersPerCue.
 */
export function isMaxCharactersPerCueValid(value: number): boolean {
  return Number.isInteger(value) && value >= 10 && value <= 80
}

const HEX8_PATTERN = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})$/

function splitHex8(hex8: string | null | undefined): { color: string; alpha: number } {
  const match = HEX8_PATTERN.exec(hex8 ?? '')
  if (!match) return { color: '#000000', alpha: 50 }
  const alpha = Math.round((Number.parseInt(match[2], 16) / 255) * 100)
  return { color: `#${match[1].toUpperCase()}`, alpha }
}

function composeHex8(color: string, alpha: number): string {
  const hex = color.replace(/^#/, '').toUpperCase()
  const alphaByte = Math.round((Math.max(0, Math.min(100, alpha)) / 100) * 255)
  const alphaHex = alphaByte.toString(16).padStart(2, '0').toUpperCase()
  return `#${hex}${alphaHex}`
}

function hexToRgba(hex: string, alpha: number): string {
  const h = (hex ?? '#000000').replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = Number.parseInt(full.slice(0, 2), 16) || 0
  const g = Number.parseInt(full.slice(2, 4), 16) || 0
  const b = Number.parseInt(full.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

type MaxCharactersPerCueFieldProps = {
  value: number
  locked: boolean
  invalid: boolean
  onChange: (value: number) => void
}

/**
 * M-B — CHARACTERS-only input (docs/16 §7.4, W2 contract 10..80 integer).
 * Extracted as a presentational unit so SSR tests can assert the input, help
 * text and validation state directly; the panel renders it only when
 * `displayMode === 'CHARACTERS'`. The backend stays the validation authority.
 */
export function MaxCharactersPerCueField({
  value,
  locked,
  invalid,
  onChange,
}: MaxCharactersPerCueFieldProps) {
  const { t } = useTranslation(['media', 'common'])
  return (
    <div className="space-y-1">
      <label className="field-label">
        <span>{t('media:renderPrep.maxCharactersPerCue')}</span>
        <input
          type="number"
          className="field-input"
          min={10}
          max={80}
          step={1}
          value={value}
          disabled={locked}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
      <p className="field-help m-0">{t('media:renderPrep.maxCharactersPerCueHint')}</p>
      {invalid && <p className="field-error m-0">{t('media:renderPrep.maxCharactersInvalid')}</p>}
    </div>
  )
}

/**
 * Phase 6 — canonical presentation payload for the additive PUT render-config.
 * Typography is included only when the user explicitly set a value (it is an
 * override over the snapshot — defaults must never be synthesized); mask is
 * included only when enabled; typography/mask are HARD_SUB-only (the backend
 * rejects them for SOFT_SUB with PRESENTATION_HARD_SUB_ONLY). Audio defaults
 * are idempotent with the backend. Exported as a pure helper for tests.
 */
export function buildPresentationPayload(draft: RenderPresentationDraft): RenderPresentationConfig {
  const hardSub = draft.subtitleMode === 'HARD_SUB'
  const coverOn = hardSub && draft.coverEnabled && draft.coverLayers.length > 0
  return {
    subtitle: {
      schemaVersion: 1,
      displayMode: draft.displayMode,
      // M-B (W2 precedence): PHRASE → wordsPerPhrase, CHARACTERS →
      // maxCharactersPerCue, SENTENCE/WORD → neither. A stale value from a
      // previous mode is never sent (the builder keys each field to its mode).
      wordsPerPhrase: draft.displayMode === 'PHRASE' ? draft.wordsPerPhrase : null,
      maxCharactersPerCue:
        draft.displayMode === 'CHARACTERS' ? draft.maxCharactersPerCue : null,
      typography: hardSub && (
        draft.fontSize !== null
        || draft.bold !== null
        || draft.outlineWidth != null
        || draft.outlineColor != null
      )
        ? {
            fontSize: draft.fontSize,
            bold: draft.bold,
            ...(draft.outlineWidth != null ? { outlineWidth: draft.outlineWidth } : {}),
            ...(draft.outlineColor != null ? { outlineColor: draft.outlineColor } : {}),
          }
        : null,
      // V2 layers are authoritative; the v1 mask is explicitly null so the
      // full-replacement PUT never leaves a stale mask beside the layers
      // (validator rejects mask XOR layers — fail-closed).
      layers: coverOn ? toWireLayers(draft.coverLayers) : null,
      mask: null,
    },
    audio: {
      schemaVersion: 1,
      originalGainDb: draft.originalGainDb,
      ttsGainDb: draft.ttsGainDb,
      ducking: { enabled: draft.duckingEnabled, gainDb: draft.duckingGainDb },
      ttsTempo: draft.ttsTempo,
    },
  }
}

/**
 * Phase 6 — HARD_SUB-only presentation block styling. For SOFT_SUB the
 * typography/mask controls are dimmed and inert: the player decides mov_text
 * presentation and the backend rejects these fields with
 * PRESENTATION_HARD_SUB_ONLY. Pure helper so tests can assert the wiring.
 */
export function typographyMaskBlockClass(subtitleMode: SubtitleMode): string {
  return subtitleMode === 'SOFT_SUB' ? 'pointer-events-none opacity-50' : ''
}

// ─── Audio presentation (docs/19 §1.8.1) — shared controlled config ────────

export type AudioPresentationValues = {
  originalGainDb: number
  ttsGainDb: number
  duckingEnabled: boolean
  duckingGainDb: number
  ttsTempo: number
}

/** Server-side defaults — idempotent with the backend AUDIO_MIX compiler. */
export const DEFAULT_AUDIO_PRESENTATION: AudioPresentationValues = {
  originalGainDb: 0,
  ttsGainDb: 0,
  duckingEnabled: true,
  duckingGainDb: -12,
  ttsTempo: 1,
}

/**
 * Phase 6 — engine-neutral audio controls (gains / ducking / tempo) compiled by
 * the backend AUDIO_MIX stage. Presentational + controlled so the Finish &
 * Render section can host it in its own column (row 1) while the confirm
 * payload in {@link RenderPreparationPanel} reads the same values.
 */
export function AudioPresentationConfig({
  audio,
  locked,
  onChange,
  collapsible = true,
}: {
  audio: AudioPresentationValues
  locked: boolean
  onChange: (next: AudioPresentationValues) => void
  collapsible?: boolean
}) {
  const { t } = useTranslation(['media'])
  const content = (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field-label">
          <span>{t('media:renderPrep.originalGain')}</span>
          <input
            type="number"
            className="field-input"
            min={-30}
            max={12}
            step={0.5}
            value={audio.originalGainDb}
            disabled={locked}
            onChange={(e) =>
              onChange({
                ...audio,
                originalGainDb: Math.max(-30, Math.min(12, Number(e.target.value))),
              })
            }
          />
        </label>
        <label className="field-label">
          <span>{t('media:renderPrep.ttsGain')}</span>
          <input
            type="number"
            className="field-input"
            min={-30}
            max={12}
            step={0.5}
            value={audio.ttsGainDb}
            disabled={locked}
            onChange={(e) =>
              onChange({
                ...audio,
                ttsGainDb: Math.max(-30, Math.min(12, Number(e.target.value))),
              })
            }
          />
        </label>
        <label className="field-label">
          <span>{t('media:renderPrep.ttsTempo')}</span>
          <input
            type="number"
            className="field-input"
            min={0.8}
            max={1.2}
            step={0.05}
            value={audio.ttsTempo}
            disabled={locked}
            onChange={(e) =>
              onChange({
                ...audio,
                ttsTempo: Math.max(0.8, Math.min(1.2, Number(e.target.value))),
              })
            }
          />
        </label>
      </div>

      <div className="mt-3 space-y-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3">
        <label className="audio-ducking-toggle">
          <input
            type="checkbox"
            checked={audio.duckingEnabled}
            disabled={locked}
            onChange={(e) => onChange({ ...audio, duckingEnabled: e.target.checked })}
          />
          <span>
            <strong>{t('media:renderPrep.ducking')}</strong>
            <small>{t('media:renderPrep.duckingHint')}</small>
          </span>
        </label>
        {audio.duckingEnabled && (
          <label className="field-label pl-6">
            <span>{t('media:renderPrep.duckingGain')}</span>
            <input
              type="number"
              className="field-input"
              min={-30}
              max={0}
              step={1}
              value={audio.duckingGainDb}
              disabled={locked || !audio.duckingEnabled}
              onChange={(e) =>
                onChange({
                  ...audio,
                  duckingGainDb: Math.max(-30, Math.min(0, Number(e.target.value))),
                })
              }
            />
          </label>
        )}
      </div>
      <p className="field-help m-0 pt-3">{t('media:renderPrep.audioMixNote')}</p>
    </>
  )

  if (!collapsible) {
    return <div data-testid="audio-config-expanded">{content}</div>
  }
  return (
    <details className="media-config-group" open={!locked}>
      <summary>{t('media:renderPrep.audioTitle')}</summary>
      {content}
    </details>
  )
}

/**
 * §1.8.2 redesign — numbered config group (①..④). A media-config-group shell
 * with an index badge and an optional status mark; content stays the historical
 * controls (contracts/testids unchanged inside).
 */
export function RenderGroup({
  index,
  title,
  open = false,
  status,
  testid,
  children,
}: {
  index: string
  title: string
  open?: boolean
  status?: 'done' | 'attention' | null
  testid?: string
  children: ReactNode
}) {
  return (
    <details className="media-config-group media-render-group" open={open} data-testid={testid}>
      <summary>
        <span className="media-render-group-index">{index}</span>
        <span className="media-render-group-title">{title}</span>
        {status && (
          <span
            className={cn('media-render-group-status', status)}
            data-testid={testid ? `${testid}-status` : undefined}
          >
            {status === 'done' ? '✓' : '!'}
          </span>
        )}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  )
}

/** §1.8.2 redesign follow-up: small subgroup heading inside a numbered group —
 * groups the flat control stacks (position / colors / typography / cover). */
function SubHead({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <h4
      className="m-0 border-b border-[var(--color-border)] pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
      data-testid={testid}
    >
      {children}
    </h4>
  )
}

function pointerLinePercent(event: ReactPointerEvent<HTMLElement>): number {
  const frame = event.currentTarget.parentElement
  if (!frame) return 50
  const rect = frame.getBoundingClientRect()
  if (rect.height <= 0) return 50
  return Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
}

function pointerPositionPercent(event: ReactPointerEvent<HTMLElement>): {
  xPercent: number
  yPercent: number
} {
  const frame = event.currentTarget.parentElement
  if (!frame) return { xPercent: 50, yPercent: 50 }
  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return { xPercent: 50, yPercent: 50 }
  return {
    xPercent: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    yPercent: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  }
}

/**
 * OUTPUT-ASPECT preview ratios (docs/97 §19.19) — the Finish & Render stage
 * itself carries the selected output frame. ORIGINAL = no reframe, so the
 * canvas follows the SOURCE video ratio (read from the video metadata);
 * 16:9 is only the fallback before metadata loads. Explicit values mirror
 * the worker blur-pad target frame.
 */
const RENDER_PREVIEW_ASPECT_RATIOS: Record<OutputAspectRatio, number> = {
  'ORIGINAL': 16 / 9,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '1:1': 1,
}

/**
 * Single display height for every preview frame — the canvas width derives
 * from it (`width = height × ratio`, capped at 100%), so 16:9/9:16/4:3/1:1
 * all render at the same height. Subtitle/overlay geometry sizes in `cqh`
 * (percent of frame height, like the worker's PlayResY math), therefore the
 * sample text keeps the same absolute size across aspects instead of looking
 * oversized inside a tall 9:16 frame.
 */
const RENDER_PREVIEW_DISPLAY_HEIGHT = 'min(54vh, 460px)'

/** Guard for source-metadata ratios — garbage values fall back to 16:9. */
function sanitizeSourceRatio(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const ratio = width / height
  if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 4) return null
  return ratio
}

/** Preview mask/layer rectangle — worker-contract geometry in percent space. */
function PreviewOverlayBox({
  overlay,
  selected,
  locked,
  label,
  onSelect,
  onMove,
}: {
  overlay: PreviewOverlay
  selected: boolean
  locked: boolean
  label: string
  onSelect: () => void
  onMove: (xPercent: number, yPercent: number) => void
}) {
  const dragDelta = useRef<{ xPercent: number; yPercent: number } | null>(null)
  const s = overlay.style
  const style: CSSProperties = {
    left: `${overlay.centerXPercent}%`,
    top: `${overlay.topPercent}%`,
    width: `${overlay.widthPercent}%`,
    height: `${overlay.heightPercent}%`,
  }
  const isBlur = s.kind === 'mask' ? s.style === 'BLUR' : s.layerType === 'BLUR'
  if (isBlur) {
    style.backdropFilter = `blur(${s.blurRadius ?? 0}px)`
    style.background = 'rgba(0, 0, 0, 0.08)'
    style.border = '1px dashed rgba(15, 23, 42, 0.45)'
  } else {
    style.background = hexToRgba(s.color ?? '#000000', (s.opacityPercent ?? 0) / 100)
  }
  return (
    <div
      className={cn(
        'absolute -translate-x-1/2',
        locked ? 'pointer-events-none' : 'preview-direct-manipulation',
        selected && !locked && 'selected',
      )}
      style={style}
      data-testid={`render-prep-overlay-${overlay.key}`}
      data-selected={selected || undefined}
      role={locked ? undefined : 'button'}
      aria-label={locked ? undefined : label}
      tabIndex={locked ? undefined : 0}
      onPointerDown={(event) => {
        if (locked) return
        event.preventDefault()
        onSelect()
        const pointer = pointerPositionPercent(event)
        dragDelta.current = {
          xPercent: pointer.xPercent - overlay.centerXPercent,
          yPercent: pointer.yPercent - overlay.centerYPercent,
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (locked || dragDelta.current === null) return
        const pointer = pointerPositionPercent(event)
        onMove(
          Math.round(clampOverlayCenterPercent(
            pointer.xPercent - dragDelta.current.xPercent,
            overlay.widthPercent,
          )),
          Math.round(clampOverlayCenterPercent(
            pointer.yPercent - dragDelta.current.yPercent,
            overlay.heightPercent,
          )),
        )
      }}
      onPointerUp={(event) => {
        dragDelta.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => {
        dragDelta.current = null
      }}
    />
  )
}

export function RenderPreparationPanel({
  workspaceId,
  job,
  provider,
  voices,
  canEdit,
  hideVoiceGrid = false,
  audio,
  onAudioChange,
  voiceSlot,
}: Props) {
  const { t } = useTranslation(['media', 'common'])
  const translateReady = job.stages.some(
    (stage) => stage.stageName === 'TRANSLATE' && stage.status === 'COMPLETED',
  )
  // Phase 6 (docs/19 §1.8.1): audio presentation is only meaningful when the
  // AUDIO_MIX stage executes — legacy jobs (absent/SKIPPED) hide the controls.
  const audioMixStage = job.stages.find((stage) => stage.stageName === 'AUDIO_MIX')
  const audioAvailable = Boolean(audioMixStage && String(audioMixStage.status).toUpperCase() !== 'SKIPPED')
  const configQuery = useRenderConfig(workspaceId, job.id, translateReady)
  const updateConfig = useUpdateRenderConfig(workspaceId, job.id)
  const confirmRender = useConfirmRender(workspaceId, job.id)
  const rerunRender = useRerunRender(workspaceId, job.id)
  const selectVoice = useSelectVoice(workspaceId, job.id)
  const preview = useVoicePreview(workspaceId)

  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('HARD_SUB')
  const [position, setPosition] = useState<SubtitlePosition>('BOTTOM')
  const [offset, setOffset] = useState(0)
  const [backgroundBox, setBackgroundBox] = useState(true)
  // OUTPUT-ASPECT (docs/97 §19.19): requested output frame — mode-independent,
  // reframe (blur-pad) runs in the worker BEFORE subtitles/layers burn.
  const [outputAspectRatio, setOutputAspectRatio] = useState<OutputAspectRatio>('ORIGINAL')
  // PRESET-VIZ (docs/97 §19.16): text background color (#RRGGBB) + alpha slider,
  // composed to #RRGGBBAA for the legacy-path BackColour. textColor (#RRGGBB)
  // is the legacy-path PrimaryColour. Both are HARD_SUB-only (SOFT_SUB ignores
  // them — the player renders mov_text presentation instead).
  const [backgroundColor, setBackgroundColor] = useState('#FFFF00')
  const [backgroundAlpha, setBackgroundAlpha] = useState(100)
  const [textColor, setTextColor] = useState('#000000')
  // Phase 6 presentation draft (docs/19 §1.8.1) — hydrated from the server.
  const [displayMode, setDisplayMode] = useState<SubtitleDisplayMode>('SENTENCE')
  const [wordsPerPhrase, setWordsPerPhrase] = useState(3)
  // M-B (W2): 10..80 when CHARACTERS — the mid-range default keeps a mode
  // switch to CHARACTERS always valid; the backend remains the authority.
  const [maxCharactersPerCue, setMaxCharactersPerCue] = useState(40)
  const [fontSize, setFontSize] = useState<number | null>(null)
  const [bold, setBold] = useState<boolean | null>(null)
  // V2 cover layers (docs/97 §19.17 §B): editors always emit `layers`; the
  // legacy v1 mask is hydrated into the equivalent single SUBTITLE layer and
  // never written back. Defaults: off with one BLUR layer ready to configure.
  const [coverEnabled, setCoverEnabled] = useState(false)
  const [coverLayers, setCoverLayers] = useState<PresentationLayer[]>(() => [
    defaultCoverLayer([]),
  ])
  const [selectedCoverLayerId, setSelectedCoverLayerId] = useState<string | null>('cover-1')
  const subtitleDragDelta = useRef<number | null>(null)
  // OUTPUT-ASPECT blur-pad visualization refs (docs/97 §19.19): the blurred
  // cover backdrop follows the foreground player (same sync pattern as the
  // preset calibration preview — play/pause/seek/drift correction).
  const blurVideoRef = useRef<HTMLVideoElement | null>(null)
  const foregroundVideoRef = useRef<HTMLVideoElement | null>(null)
  // ORIGINAL preview follows the source frame — intrinsic dimensions captured
  // from the video metadata (a 9:16 source previews tall, not forced 16:9).
  const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(null)
  // Phase 6 V2 (docs/97 §19.17): ring outline override subset. null/'' = the
  // stored field is cleared on save (explicit null in the typography patch).
  const [outlineWidth, setOutlineWidth] = useState<number | null>(null)
  const [outlineColor, setOutlineColor] = useState<string | null>(null)
  const [originalGainDb, setOriginalGainDb] = useState(0)
  const [ttsGainDb, setTtsGainDb] = useState(0)
  const [duckingEnabled, setDuckingEnabled] = useState(true)
  const [duckingGainDb, setDuckingGainDb] = useState(-12)
  const [ttsTempo, setTtsTempo] = useState(1)
  // Phase C: authoritative binding — the voice ROW id (job.ttsVoiceId), not the
  // legacy voice_id string. Fallback to the legacy string only for unbound
  // legacy jobs (kept for display; any change goes through the backend pair).
  const [voiceDraft, setVoiceDraft] = useState(job.ttsVoiceId ?? job.voiceId ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  // Optimistic lock while confirm request is in flight (mirrors ProposalPanel activatingId).
  const [confirming, setConfirming] = useState(false)
  // Embedded-audio presence never changes for a mount — a ref keeps the
  // hydration effect dependency-clean (adding `audio` would re-hydrate and
  // clobber the user's draft on every audio tweak).
  const embeddedAudioRef = useRef(audio !== undefined && onAudioChange !== undefined)
  // §1.8.2 redesign: values as hydrated from the stored render config — the
  // draft badge / Save button diff the live draft against this snapshot.
  const [storedSnapshot, setStoredSnapshot] = useState<Record<string, unknown> | null>(null)

  useEffect(() => setVoiceDraft(job.ttsVoiceId ?? job.voiceId ?? ''), [job.ttsVoiceId, job.voiceId])
  useEffect(() => {
    if (!configQuery.data) return
    setSubtitleMode(configQuery.data.subtitleMode)
    setPosition(configQuery.data.subtitlePosition)
    setOffset(configQuery.data.verticalOffsetPercent)
    setBackgroundBox(configQuery.data.backgroundBox)
    setOutputAspectRatio(configQuery.data.outputAspectRatio ?? 'ORIGINAL')
    // PRESET-VIZ (docs/97 §19.16): hydrate the manual background/text color
    // pickers from the stored render config (legacy path only).
    const bg = splitHex8(configQuery.data.backgroundColor)
    setBackgroundColor(bg.color)
    setBackgroundAlpha(bg.alpha)
    setTextColor(/^#[0-9A-Fa-f]{6}$/.test(configQuery.data.textColor ?? '')
      ? (configQuery.data.textColor as string).toUpperCase()
      : '#FFFFFF')
    // Phase 6: hydrate the presentation draft from the stored envelope.
    const sub = configQuery.data.presentation?.subtitle
    const aud = configQuery.data.presentation?.audio
    const mask = sub?.mask
    setDisplayMode(sub?.displayMode ?? 'SENTENCE')
    setWordsPerPhrase(sub?.wordsPerPhrase ?? 3)
    setMaxCharactersPerCue(sub?.maxCharactersPerCue ?? 40)
    setFontSize(sub?.typography?.fontSize ?? null)
    setBold(sub?.typography?.bold ?? null)
    setOutlineWidth(sub?.typography?.outlineWidth ?? null)
    setOutlineColor(sub?.typography?.outlineColor ?? null)
    const cover = hydrateCoverState({ mask, layers: sub?.layers ?? null })
    setCoverEnabled(cover.enabled)
    setCoverLayers(cover.layers)
    setSelectedCoverLayerId(cover.layers[0]?.id ?? null)
    setOriginalGainDb(aud?.originalGainDb ?? 0)
    setTtsGainDb(aud?.ttsGainDb ?? 0)
    setDuckingEnabled(aud?.ducking?.enabled ?? true)
    setDuckingGainDb(aud?.ducking?.gainDb ?? -12)
    setTtsTempo(aud?.ttsTempo ?? 1)
    // §1.8.2 redesign: remember exactly what was hydrated so the live draft
    // can be diffed against the stored config (draft badge + Save button).
    setStoredSnapshot({
      subtitleMode: configQuery.data.subtitleMode,
      position: configQuery.data.subtitlePosition,
      offset: configQuery.data.verticalOffsetPercent,
      backgroundBox: configQuery.data.backgroundBox,
      outputAspectRatio: configQuery.data.outputAspectRatio ?? 'ORIGINAL',
      backgroundColor: composeHex8(bg.color, bg.alpha),
      textColor: /^#[0-9A-Fa-f]{6}$/.test(configQuery.data.textColor ?? '')
        ? (configQuery.data.textColor as string).toUpperCase()
        : '#FFFFFF',
      displayMode: sub?.displayMode ?? 'SENTENCE',
      wordsPerPhrase: sub?.wordsPerPhrase ?? 3,
      maxCharactersPerCue: sub?.maxCharactersPerCue ?? 40,
      fontSize: sub?.typography?.fontSize ?? null,
      bold: sub?.typography?.bold ?? null,
      outlineWidth: sub?.typography?.outlineWidth ?? null,
      outlineColor: sub?.typography?.outlineColor
        ? (sub.typography.outlineColor as string).toUpperCase()
        : null,
      coverEnabled: cover.enabled,
      coverLayers: toWireLayers(cover.layers),
      ...(!embeddedAudioRef.current
        ? {
            originalGainDb: aud?.originalGainDb ?? 0,
            ttsGainDb: aud?.ttsGainDb ?? 0,
            duckingEnabled: aud?.ducking?.enabled ?? true,
            duckingGainDb: aud?.ducking?.gainDb ?? -12,
            ttsTempo: aud?.ttsTempo ?? 1,
          }
        : {}),
    })
  }, [configQuery.data])

  const serverConfirmed = configQuery.data?.confirmed === true
  // M-A: AUTO jobs are frozen read-only — the workflow mode is the authority
  // (never derived from stage status alone), so TTS FAILED/CANCELLED cannot
  // open an editable path for AUTO (no confirm endpoint exists for AUTO).
  const autoFrozen = resolveWorkflowMode(job) === 'AUTO'
  // C2 (docs/97 §19.14): CP-B = EVERY MANUAL job — confirmationScope is now
  // mode-derived (isRenderConfirmationRecipe). AUTO stays frozen read-only.
  const confirmationScope = isRenderConfirmationRecipe(job)
  // C2 (BA review P1): voice is confirm-mandatory ONLY for generative
  // (dubbing-mandatory). Extractive / localization confirm voice-less
  // (original-only, TTS SKIPPED — Q-M-WORKFLOW-06); the backend is authority.
  const voiceRequired = isGenerativeRecipe(job)
  const isSummary = isGenerativeRecipe(job) || isSummaryRecipe(job)
  const stageLocked = isRenderPrepLocked(job, serverConfirmed, autoFrozen)
  // Drop optimistic lock once poll/config reflects terminal or unlocked state.
  useEffect(() => {
    if (!confirming) return
    if (serverConfirmed || stageLocked) return
    const tts = job.stages.find((s) => s.stageName === 'TTS')
    const status = String(tts?.status ?? '').toUpperCase()
    if (status === 'FAILED' || status === 'CANCELLED') {
      setConfirming(false)
    }
  }, [confirming, serverConfirmed, stageLocked, job.stages])

  const renderStage = job.stages.find((s) => s.stageName === 'RENDER')
  const [isEditingReapply, setIsEditingReapply] = useState(false)
  const canReapplyRender =
    canEdit
    && !autoFrozen
    && (renderStage?.status === 'COMPLETED' || renderStage?.status === 'FAILED')
    && renderStage?.status !== 'PROCESSING'

  const locked =
    !canEdit
    || confirming
    || updateConfig.isPending
    || confirmRender.isPending
    || rerunRender.isPending
    || stageLocked

  const effectiveLocked = locked && !isEditingReapply

  // Finish & Render aggregation: the section owns the audio values (hydrated
  // from the same render-config query) and hosts the controls in its own row;
  // the panel only reads them for the confirm payload. Standalone keeps the
  // internal state below.
  const embeddedAudio = audio !== undefined && onAudioChange !== undefined
  const effectiveAudio: AudioPresentationValues = embeddedAudio
    ? audio
    : { originalGainDb, ttsGainDb, duckingEnabled, duckingGainDb, ttsTempo }

  // M-B (W2 contract): only CHARACTERS is validated for max characters; other
  // display modes never show a validation state for this field.
  const charactersInvalid =
    displayMode === 'CHARACTERS' && !isMaxCharactersPerCueValid(maxCharactersPerCue)

  // ── Phase 6 V2 ownership (docs/97 §19.17 §10): an assigned subtitle style
  // OWNS colors/font/background — the backend effective block lists exactly
  // which controls are dead; the FE mirrors it instead of re-deriving.
  const styleState = deriveStyleAssignment(useJobSubtitleStyle(job.id).data)
  const ownedByStyle = styleState.styleAssigned
  const effective = configQuery.data?.effective ?? null
  const deadControls = new Set(effective?.deadControls ?? [])
  const appearanceDead = (controlId: string): boolean =>
    ownedByStyle && (effective ? deadControls.has(controlId) : true)

  const outlineDisabled =
    locked
    || subtitleMode === 'SOFT_SUB'
    || ownedByStyle

  // Preview sample renders the EFFECTIVE projection ONLY — server-resolved
  // values (stored config + backend effective block + assigned snapshot),
  // never the unsaved draft state (docs/97 §19.17 §10 / D17).
  const previewSample = useMemo(() => {
    const cfg = configQuery.data
    const sub = cfg?.presentation?.subtitle
    const storedTypography = sub?.typography ?? null
    const snapshot = styleState.snapshot
    const source: EffectivePreviewSource = {
      ownedByStyle,
      resolvedLinePercent: effective
        ? effective.resolvedLinePercent
        : subtitleAnchorLinePercent(cfg?.subtitlePosition ?? 'BOTTOM', cfg?.verticalOffsetPercent ?? 0),
      boxMode: effective ? effective.boxMode : cfg?.backgroundBox ?? true,
      subtitlePosition: cfg?.subtitlePosition ?? 'BOTTOM',
      fontSize: ownedByStyle ? (snapshot?.font_size ?? null) : (storedTypography?.fontSize ?? null),
      bold: ownedByStyle ? (snapshot?.bold ?? false) : (storedTypography?.bold ?? false),
      textColor: ownedByStyle ? (snapshot?.primary_color ?? null) : (cfg?.textColor ?? null),
      mask: sub?.mask ?? null,
      layers: sub?.layers ?? null,
    }
    const projection = projectEffectivePreview(source)
    const storedBgHex8 = cfg?.backgroundColor ?? null
    const fallbackBg = storedBgHex8 || '#000000B3'
    const sampleBackground = ownedByStyle
      ? (snapshot?.background ?? (source.boxMode ? fallbackBg : null))
      : source.boxMode
        ? fallbackBg
        : null
    const bgParts = sampleBackground ? splitHex8(sampleBackground) : null
    return {
      projection,
      textColor: source.textColor,
      backgroundCss: bgParts ? hexToRgba(bgParts.color, bgParts.alpha / 100) : 'transparent',
      outlineWidth: ownedByStyle
        ? (snapshot?.outline_width ?? null)
        : (storedTypography?.outlineWidth ?? null),
      outlineColor: ownedByStyle
        ? (snapshot?.outline_color ?? null)
        : (storedTypography?.outlineColor ?? null),
    }
  }, [configQuery.data, effective, ownedByStyle, styleState.snapshot])

  // ── §1.8.2 redesign: live DRAFT preview ──
  // Same worker geometry contract (previewProjection math) fed from the
  // unsaved editor state. When a style preset owns the colors the manual
  // draft is inert → the effective projection is shown instead. This
  // intentionally supersedes the previous "never mirrors unsaved draft"
  // sample (user decision 2026-09-05, docs/19 §1.8.2 amendment).
  const draftProjection = useMemo(() => {
    const linePercent = ownedByStyle && effective
      ? effective.resolvedLinePercent
      : subtitleAnchorLinePercent(position, offset)
    const lockedBottom = position === 'BOTTOM'
    // V2 layers: every configured cover projects through the same contract
    // math the worker applies (anchors + geometry + per-layer style).
    const overlays: PreviewOverlay[] =
      subtitleMode === 'HARD_SUB' && coverEnabled
        ? projectLayers(
            coverLayers.filter((layer) => layer.enabled !== false),
            linePercent,
          )
        : []
    return {
      linePercent,
      text: {
        lockedBottom,
        bottomPercent: lockedBottom ? 100 - linePercent : null,
        topPercent: lockedBottom ? null : linePercent,
        fontSizeCqh: ((fontSize ?? DEFAULT_PREVIEW_FONT_SIZE) / PLAY_RES_Y) * 100,
        fontWeight: (bold ?? false) ? 700 : 400,
      },
      overlays,
    }
  }, [position, offset, subtitleMode, coverEnabled, coverLayers, fontSize, bold, ownedByStyle, effective])

  const activePreview = ownedByStyle
    ? {
        ...previewSample,
        projection: {
          ...previewSample.projection,
          overlays: draftProjection.overlays,
        },
        backgroundCss: (effective ? effective.boxMode : backgroundBox)
          ? (previewSample.backgroundCss !== 'transparent'
              ? previewSample.backgroundCss
              : hexToRgba(backgroundColor, backgroundAlpha / 100))
          : 'transparent',
      }
    : {
        projection: draftProjection,
        textColor,
        backgroundCss: backgroundBox
          ? hexToRgba(backgroundColor, backgroundAlpha / 100)
          : 'transparent',
        outlineWidth,
        outlineColor,
      }
  const subtitlePreviewLocked =
    effectiveLocked
    || subtitleMode !== 'HARD_SUB'
    || appearanceDead('subtitlePosition')
    || appearanceDead('verticalOffsetPercent')

  // OUTPUT-ASPECT stage layout (docs/97 §19.19): the stage itself carries the
  // output frame so every aspect centers correctly. ORIGINAL keeps the source
  // frame (metadata ratio when known, 16:9 display fallback until it loads);
  // explicit values mirror the worker blur-pad target (dims never exceed the
  // source there, so the ratio alone describes the frame).
  const isReframedPreview = outputAspectRatio !== 'ORIGINAL'
  const previewSourceVideoUrl = configQuery.data?.sourceVideoUrl ?? null
  // A new source resets the intrinsic ratio (stale dims would frame the new
  // video with the previous aspect until its metadata loads).
  useEffect(() => {
    setSourceDims(null)
  }, [previewSourceVideoUrl])
  const previewRatio = isReframedPreview
    ? (RENDER_PREVIEW_ASPECT_RATIOS[outputAspectRatio] ?? RENDER_PREVIEW_ASPECT_RATIOS['ORIGINAL'])
    : (sourceDims ? sanitizeSourceRatio(sourceDims.w, sourceDims.h) : null)
      ?? RENDER_PREVIEW_ASPECT_RATIOS['ORIGINAL']

  const draftSnapshot = {
    subtitleMode,
    position,
    offset,
    backgroundBox,
    outputAspectRatio,
    backgroundColor: composeHex8(backgroundColor, backgroundAlpha),
    textColor: (textColor ?? '').toUpperCase(),
    displayMode,
    wordsPerPhrase,
    maxCharactersPerCue,
    fontSize,
    bold,
    outlineWidth,
    outlineColor: outlineColor ? outlineColor.toUpperCase() : null,
    coverEnabled,
    coverLayers: toWireLayers(coverLayers),
    ...(!embeddedAudio
      ? { originalGainDb, ttsGainDb, duckingEnabled, duckingGainDb, ttsTempo }
      : {}),
  }
  const isDirty =
    storedSnapshot != null && JSON.stringify(draftSnapshot) !== JSON.stringify(storedSnapshot)

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.status === 429) {
      setNotice(t('media:voice.preview.rateLimited'))
      return
    }
    setNotice(`${t('media:voice.preview.error')}: ${
      error instanceof ApiError ? error.message : t('common:error.generic')
    }`)
  }

  /**
   * §1.8.2 redesign: the exact PUT body — shared by Save (without confirm)
   * and Confirm (PUT → POST confirm-render chain). Payload shape unchanged.
   */
  const buildSaveBody = () => {
    const softTarget = subtitleMode === 'SOFT_SUB'
    // Phase 6 V2 tri-state PUT (F-01, docs/97 §19.17): colors ride explicit
    // directives; the typography override subset rides a full-replacement
    // patch built from the stored node. Mode-flip HARD→SOFT must not let any
    // burn-only directive SURVIVE (backend PRESENTATION_HARD_SUB_ONLY rejects
    // survival) — the same PUT carries the explicit clears, no dead-end 422.
    const backgroundColorDirective: TriStateDirective<string> = softTarget
      ? { op: 'clear' }
      : backgroundBox
        ? { op: 'replace', value: composeHex8(backgroundColor, backgroundAlpha) }
        // Box off keeps the stored color (shipped §19.16.1 semantics): the
        // value is inert while the box is off and survives re-enabling.
        : { op: 'keep' }
    const textColorDirective: TriStateDirective<string> = softTarget
      ? { op: 'clear' }
      : textColor && /^#[0-9A-Fa-f]{6}$/.test(textColor)
        ? { op: 'replace', value: textColor.toUpperCase() }
        : { op: 'clear' }
    const outlineWidthDirective: TriStateDirective<number> =
      !softTarget && outlineWidth !== null && Number.isFinite(outlineWidth)
        ? { op: 'replace', value: Math.max(0, Math.min(8, Math.round(outlineWidth))) }
        : { op: 'clear' }
    const outlineColorDirective: TriStateDirective<string> =
      !softTarget && outlineColor && /^#[0-9A-Fa-f]{6}$/.test(outlineColor)
        ? { op: 'replace', value: outlineColor.toUpperCase() }
        : { op: 'clear' }
    const basePresentation = buildPresentationPayload({
      subtitleMode,
      displayMode,
      wordsPerPhrase,
      maxCharactersPerCue,
      fontSize,
      bold,
      coverEnabled,
      coverLayers,
      originalGainDb: effectiveAudio.originalGainDb,
      ttsGainDb: effectiveAudio.ttsGainDb,
      duckingEnabled: effectiveAudio.duckingEnabled,
      duckingGainDb: effectiveAudio.duckingGainDb,
      ttsTempo: effectiveAudio.ttsTempo,
    })
    const presentation = softTarget
      ? basePresentation
      : applyTypographyToEnvelope(basePresentation, typographyPatch({
          storedTypography: configQuery.data?.presentation?.subtitle?.typography ?? null,
          fontSize: { op: 'replace', value: fontSize },
          bold: { op: 'replace', value: bold },
          outlineWidth: outlineWidthDirective,
          outlineColor: outlineColorDirective,
        })) ?? basePresentation
    return {
      subtitleMode,
      subtitlePosition: position,
      verticalOffsetPercent: offset,
      backgroundBox,
      // OUTPUT-ASPECT rides as an explicit REPLACE every PUT (idempotent) —
      // mode-independent, so it is NOT gated behind the softTarget clear.
      outputAspectRatio,
      backgroundColor: colorDirective(backgroundColorDirective),
      textColor: colorDirective(textColorDirective),
      presentation,
    }
  }

  /** §1.8.2 redesign: persist the draft without confirming (Save button). */
  const handleSave = () => {
    if (locked || !isDirty) return
    setNotice(null)
    void updateConfig.mutateAsync(buildSaveBody()).catch(fail)
  }

  const handleConfirm = () => {
    // Hard gate like proposal select — ignore spam clicks even before React re-renders disabled.
    // C2 (docs/97 §19.14, BA review P1): the voice gate applies ONLY to
    // generative (dubbing-mandatory). Extractive / localization confirm
    // voice-less (original-only, TTS SKIPPED — Q-M-WORKFLOW-06): a missing
    // voiceDraft must never block the CP-B confirm of a non-generative job.
    if (locked || (voiceRequired && !voiceDraft) || charactersInvalid) return
    setConfirming(true)
    setNotice(null)
    void updateConfig
      .mutateAsync(buildSaveBody())
      .then(() => confirmRender.mutateAsync())
      .catch((error) => {
        setConfirming(false)
        fail(error)
      })
  }

  const handleReapplyRender = () => {
    if (charactersInvalid) return
    setNotice(null)
    void rerunRender
      .mutateAsync(buildSaveBody())
      .then(() => {
        setIsEditingReapply(false)
      })
      .catch((error) => {
        fail(error)
      })
  }

  if (!translateReady) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-secondary)]">
        {t('media:renderPrep.waiting')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div role="alert" className="fixed bottom-5 right-5 z-[100] max-w-md rounded-xl border border-amber-300 bg-white p-4 text-sm text-amber-800 shadow-xl">
          {notice}
        </div>
      )}

      <div className="media-render-grid">
      {/* LEFT — sticky preview + decision actions (§1.8.2 redesign) */}
      <div className="media-render-preview-col">
      {/* C2 (docs/97 §19.14): CP-B = every MANUAL job — the read-only
          non-CP-B branch is gone; AUTO stays frozen while MANUAL remains
          editable until confirmed. Testids stay exclusive so the lock matrix
          is unambiguous. */}
      {autoFrozen ? null : canReapplyRender && !isEditingReapply ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-[var(--color-text-primary)]"
          data-testid="render-prep-reapply-hint"
        >
          <IconRefresh size={16} className="mt-0.5 shrink-0 text-blue-500" />
          <div>
            <p className="m-0 font-semibold">{t('media:renderPrep.unlockReapply')}</p>
            <p className="mb-0 mt-0.5 text-[var(--color-text-secondary)]">
              {t('media:renderPrep.reapplyHint')}
            </p>
          </div>
        </div>
      ) : locked && canEdit && !isEditingReapply ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="render-prep-locked"
        >
          <IconLock size={16} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          <p className="m-0">{t('media:renderPrep.lockedHint')}</p>
        </div>
      ) : (
        <div
          className="flex items-start gap-2 rounded-xl border border-[var(--color-media)]/30 bg-[var(--color-media-soft)] p-3 text-sm"
          data-testid="render-prep-mandatory"
        >
          <IconRocket size={16} className="mt-0.5 shrink-0 text-[var(--color-media)]" />
          <div>
            <p className="m-0 font-semibold">{t('media:renderPrep.mandatoryTitle')}</p>
            <p className="mb-0 mt-0.5 text-[var(--color-text-secondary)]">
              {t('media:renderPrep.mandatoryDesc')}
            </p>
          </div>
        </div>
      )}

      <div
        className="media-render-preview-stage"
        data-testid="render-prep-preview-frame"
        data-aspect={outputAspectRatio}
      >
        <div
          className="media-render-preview-canvas"
          data-testid="render-prep-preview-canvas"
          data-ratio={previewRatio}
          style={{
            // Numeric <ratio> (same as the preset preview frame): the colon
            // form is not valid CSS and would collapse the frame. Width
            // derives from one shared display height so every aspect renders
            // at the same height and cqh-sized text stays comparable.
            aspectRatio: previewRatio,
            width: `min(100%, calc(${RENDER_PREVIEW_DISPLAY_HEIGHT} * ${previewRatio}))`,
            maxHeight: RENDER_PREVIEW_DISPLAY_HEIGHT,
            // The subtitle sample sizes in cqh (like the preset preview
            // frame) — without a query container these fall back to the
            // viewport height and render hugely oversized.
            containerType: 'size',
          }}
        >
        {previewSourceVideoUrl ? (
          isReframedPreview ? (
            <>
              <div
                className="absolute inset-0 overflow-hidden"
                data-testid="render-prep-preview-blur-bg"
                aria-hidden="true"
              >
                <video
                  ref={blurVideoRef}
                  src={previewSourceVideoUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover blur-xl"
                />
              </div>
              <div className="absolute inset-0 grid place-items-center">
                <video
                  ref={foregroundVideoRef}
                  src={previewSourceVideoUrl}
                  controls
                  muted
                  className="max-h-full max-w-full object-contain"
                  data-testid="render-prep-preview-video"
                  onPlay={() => {
                    void blurVideoRef.current?.play()
                  }}
                  onPause={() => {
                    blurVideoRef.current?.pause()
                  }}
                  onSeeked={(event) => {
                    if (blurVideoRef.current) {
                      blurVideoRef.current.currentTime = event.currentTarget.currentTime
                    }
                  }}
                  onTimeUpdate={(event) => {
                    const background = blurVideoRef.current
                    if (background && Math.abs(background.currentTime - event.currentTarget.currentTime) > 0.2) {
                      background.currentTime = event.currentTarget.currentTime
                    }
                  }}
                />
              </div>
            </>
          ) : (
            <video
              src={previewSourceVideoUrl}
              controls
              muted
              className="h-full w-full object-contain"
              data-testid="render-prep-preview-video"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                  setSourceDims({ w: video.videoWidth, h: video.videoHeight })
                }
              }}
            />
          )
        ) : (
          <div className="grid h-full place-items-center text-sm text-white/60">
            {t('common:loading')}
          </div>
        )}
        {activePreview.projection.overlays.map((overlay) => {
          const layer = coverLayers.find((candidate) => candidate.id === overlay.key)
          const overlayLocked = !layer || effectiveLocked || subtitleMode !== 'HARD_SUB'
          return (
            <PreviewOverlayBox
              key={overlay.key}
              overlay={overlay}
              selected={selectedCoverLayerId === overlay.key}
              locked={overlayLocked}
              label={t('media:renderPrep.dragCoverLayer')}
              onSelect={() => setSelectedCoverLayerId(overlay.key)}
              onMove={(xPercent, yPercent) => {
                if (!layer) return
                setCoverLayers((current) => current.map((candidate) =>
                  candidate.id === layer.id
                    ? {
                        ...candidate,
                        geometry: { ...candidate.geometry, xPercent, yPercent },
                      }
                    : candidate,
                ))
              }}
            />
          )
        })}
        {subtitleMode === 'HARD_SUB' && (
          <div
            className={cn(
              // Centered via inset-x-0 + margin auto + fit-content (NOT
              // left-1/2 + translate): with width:auto an abs-pos element may
              // only use (100% − left) of the frame, so on a narrow 9:16
              // canvas the sample wrapped to 3 lines. fit-content resolves
              // against the full frame width like the worker's libass wrap
              // width (PlayResX − margins), so the sample stays on one line
              // while genuinely long cues still wrap. max-w-95% mirrors the
              // worker text budget (~97% of the frame — measured: the VI/EN
              // samples need ~92-95% incl. padding on a 9:16 canvas); 86%
              // wrapped them a full line earlier than the burned output.
              'absolute inset-x-0 mx-auto w-fit max-w-[95%] text-center font-semibold shadow-black [text-shadow:0_1px_3px_var(--tw-shadow-color)]',
              subtitlePreviewLocked ? 'pointer-events-none' : 'preview-direct-manipulation',
            )}
            style={{
              // §1.8.2 redesign: LIVE draft preview — the overlay mirrors the
              // unsaved editor state through the same worker geometry contract;
              // when a style preset owns the colors the effective projection is
              // shown instead (the manual draft is inert there).
              ...(activePreview.projection.text.lockedBottom
                ? { bottom: `${activePreview.projection.text.bottomPercent}%` }
                : { top: `${activePreview.projection.text.topPercent}%` }),
              // BOTTOM anchors the block's bottom edge at bottomPercent (worker
              // Alignment 2 MarginV), TOP/CENTER anchor the top edge — same as
              // the preset preview frame. No translate: horizontal centering
              // is margin-auto (see className) so the layout width is never
              // halved on narrow frames.
              fontSize: `${activePreview.projection.text.fontSizeCqh}cqh`,
              fontWeight: activePreview.projection.text.fontWeight,
              background: activePreview.backgroundCss,
              // Horizontal padding stays inside max-width (content-box): 0.45em
              // keeps the sample + padding within the frame on 9:16 while the
              // worker box hugs the glyphs with no padding at all.
              padding: activePreview.backgroundCss !== 'transparent' ? '0.25em 0.45em' : undefined,
              borderRadius: activePreview.backgroundCss !== 'transparent' ? '0.35em' : undefined,
              boxShadow: activePreview.backgroundCss !== 'transparent' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : undefined,
              WebkitTextStroke:
                (activePreview.outlineWidth ?? 0) > 0
                  ? `${((activePreview.outlineWidth ?? 2) / PLAY_RES_Y) * 100}cqh ${activePreview.outlineColor ?? '#000000'}`
                  : undefined,
              paintOrder: 'stroke fill',
              color: /^#[0-9A-Fa-f]{6}$/.test(activePreview.textColor ?? '') ? activePreview.textColor : '#FFFFFF',
            }}
            data-testid="render-prep-draft-sample"
            role={subtitlePreviewLocked ? undefined : 'button'}
            aria-label={subtitlePreviewLocked ? undefined : t('media:renderPrep.dragSubtitle')}
            tabIndex={subtitlePreviewLocked ? undefined : 0}
            onPointerDown={(event) => {
              if (subtitlePreviewLocked) return
              event.preventDefault()
              subtitleDragDelta.current = pointerLinePercent(event) - activePreview.projection.linePercent
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (subtitlePreviewLocked || subtitleDragDelta.current === null) return
              const next = snapSubtitlePlacement(
                pointerLinePercent(event) - subtitleDragDelta.current,
              )
              setPosition(next.position)
              setOffset(next.verticalOffsetPercent)
            }}
            onPointerUp={(event) => {
              subtitleDragDelta.current = null
              event.currentTarget.releasePointerCapture?.(event.pointerId)
            }}
            onPointerCancel={() => {
              subtitleDragDelta.current = null
            }}
          >
            {t('media:renderPrep.subtitleSample')}
          </div>
        )}
        </div>
        {!autoFrozen && (
          <span
            className={cn('media-render-draft-badge', isDirty ? 'dirty' : 'clean')}
            data-testid="render-prep-draft-badge"
          >
            {isDirty ? t('media:renderPrep.draftBadge') : t('media:renderPrep.draftBadgeClean')}
          </span>
        )}
      </div>

      {!effectiveLocked && subtitleMode === 'HARD_SUB' && (
        <p className="field-help m-0">{t('media:renderPrep.previewDragHint')}</p>
      )}

      <div className="media-render-summary" data-testid="render-prep-summary">
        <span className="chip">
          {subtitleMode === 'HARD_SUB' ? t('media:subtitleHard') : t('media:subtitleSoft')}
        </span>
        {(job.ttsVoiceDisplayName || job.voiceId) && (
          <span className="chip">{job.ttsVoiceDisplayName ?? job.voiceId}</span>
        )}
        {ownedByStyle && <span className="chip">{t('media:renderPrep.summaryStyleChip')}</span>}
      </div>

      {confirmationScope && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canReapplyRender ? (
            isEditingReapply ? (
              <>
                <button
                  type="button"
                  className="btn-media-secondary"
                  data-testid="render-reapply-cancel"
                  disabled={rerunRender.isPending}
                  onClick={() => {
                    setIsEditingReapply(false)
                    if (configQuery.data) {
                      const d = configQuery.data
                      setSubtitleMode(d.subtitleMode ?? 'HARD_SUB')
                      setPosition(d.subtitlePosition ?? 'BOTTOM')
                      setOffset(d.verticalOffsetPercent ?? 0)
                      setBackgroundBox(d.backgroundBox ?? true)
                      setBackgroundColor(d.backgroundColor ? d.backgroundColor.slice(0, 7) : '#000000')
                      setBackgroundAlpha(
                        d.backgroundColor && d.backgroundColor.length === 9
                          ? Math.round((parseInt(d.backgroundColor.slice(7, 9), 16) / 255) * 100)
                          : 50
                      )
                      setTextColor(d.textColor ?? '#FFFFFF')
                      setOutputAspectRatio(d.outputAspectRatio ?? 'ORIGINAL')
                      const sub = d.presentation?.subtitle
                      setDisplayMode(sub?.displayMode ?? 'SENTENCE')
                      setWordsPerPhrase(sub?.wordsPerPhrase ?? 5)
                      setMaxCharactersPerCue(sub?.maxCharactersPerCue ?? 36)
                      setFontSize(sub?.typography?.fontSize ?? null)
                      setBold(sub?.typography?.bold ?? null)
                      setOutlineWidth(sub?.typography?.outlineWidth ?? null)
                      setOutlineColor(
                        sub?.typography?.outlineColor
                          ? (sub.typography.outlineColor as string).toUpperCase()
                          : null
                      )
                      const cover = hydrateCoverState({ mask: sub?.mask, layers: sub?.layers })
                      setCoverEnabled(cover.enabled)
                      setCoverLayers(toWireLayers(cover.layers))
                      setSelectedCoverLayerId(cover.layers[0]?.id ?? null)
                    }
                  }}
                >
                  {t('common:actions.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="render-reapply-confirm"
                  disabled={rerunRender.isPending || charactersInvalid}
                  onClick={handleReapplyRender}
                >
                  {rerunRender.isPending
                    ? <IconLoader2 size={16} className="animate-spin" />
                    : <IconRefresh size={16} />}
                  {t('media:renderPrep.reapplyRender')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-media-secondary"
                data-testid="render-reapply-unlock"
                onClick={() => setIsEditingReapply(true)}
              >
                <IconRefresh size={16} />
                {t('media:renderPrep.unlockReapply')}
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                className="btn-media-secondary"
                data-testid="render-config-save"
                disabled={!isDirty || locked}
                onClick={handleSave}
              >
                {updateConfig.isPending
                  ? <IconLoader2 size={16} className="animate-spin" />
                  : <IconDeviceFloppy size={16} />}
                {t('media:renderPrep.saveConfig')}
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="render-prep-confirm"
                disabled={locked || (voiceRequired && !voiceDraft) || charactersInvalid}
                onClick={handleConfirm}
              >
                {(confirming || updateConfig.isPending || confirmRender.isPending)
                  ? <IconLoader2 size={16} className="animate-spin" />
                  : locked
                    ? <IconLock size={16} />
                    : <IconRocket size={16} />}
                {locked && serverConfirmed
                  ? t('media:renderPrep.confirmed')
                  : t('media:renderPrep.confirm')}
              </button>
            </>
          )}
        </div>
      )}
      </div>

      {/* RIGHT — numbered config groups (§1.8.2 redesign) */}
      <div className="media-render-groups">

      {!hideVoiceGrid && (
        <RenderGroup index="①" title={t('media:renderPrep.voiceTitle')} open>
          {!provider && (
            <p className="field-error m-0">{t('media:renderPrep.noProvider')}</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {voices.map((voice) => (
              <div
                key={voice.id}
                className={`media-voice-item ${voiceDraft === voice.id ? 'selected' : ''}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  disabled={locked || selectVoice.isPending}
                  onClick={() => {
                    if (locked || !provider) return
                    const previous = voiceDraft
                    setVoiceDraft(voice.id)
                    setNotice(null)
                    // Phase C: send the authoritative pair (provider row id +
                    // voice ROW id) — never the legacy voice_id string, which the
                    // backend no longer accepts as a UUID binding (C5 P1 fix).
                    // provider is guaranteed non-null here (P2 guard).
                    void selectVoice
                      .mutateAsync({ providerId: provider.id, voiceId: voice.id })
                      .catch((error) => {
                        setVoiceDraft(previous)
                        fail(error)
                      })
                  }}
                >
                  <span className="media-voice-avatar">{(voice.displayName || '?')[0]}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{voice.displayName}</span>
                    <span className="block text-xs text-[var(--color-text-tertiary)]">
                      {voice.language} · {voice.gender}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-media-secondary btn-sm shrink-0"
                  aria-label={t('media:voice.preview.action')}
                  disabled={!provider || preview.isPending}
                  onClick={() => {
                    if (!provider) return
                    setNotice(null)
                    void preview.mutateAsync({
                      providerId: provider.id,
                      voiceId: voice.voiceId,
                      language: job.targetLang,
                    }).catch(fail)
                  }}
                >
                  {preview.isPending && preview.variables?.voiceId === voice.voiceId
                    ? <IconLoader2 size={15} className="animate-spin" />
                    : <IconPlayerPlay size={15} />}
                  {t('media:voice.preview.action')}
                </button>
              </div>
            ))}
          </div>
          {voices.length === 0 && <p className="field-error m-0">{t('media:renderPrep.noVoice')}</p>}
        </RenderGroup>
      )}
      {hideVoiceGrid && voiceSlot && (
        <RenderGroup
          index="①"
          title={t('media:panels.voice')}
          open
          testid="finish-voice-block"
        >
          {voiceSlot}
        </RenderGroup>
      )}

        <RenderGroup index="②" title={t('media:renderPrep.subtitleLayerAppearanceTitle')} open>
          <div className="space-y-3">
            {ownedByStyle && (
              <>
                <div
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-media)]/40 bg-[var(--color-media-soft)] px-3 py-2 text-xs"
                  data-testid="style-ownership-chip"
                  title={t('media:renderPrep.ownershipTooltip')}
                >
                  <IconLock size={14} className="shrink-0 text-[var(--color-media)]" />
                  <span className="font-semibold">{t('media:renderPrep.ownershipChip')}</span>
                </div>
                {styleState.snapshot && (
                  <details className="media-config-group" data-testid="style-ownership-readout">
                    <summary>{t('media:renderPrep.styleReadoutTitle')}</summary>
                    <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-0.5 pt-2 text-[11px] sm:grid-cols-2">
                      {Object.entries(styleState.snapshot).map(([field, value]) => (
                        <div key={field} className="flex justify-between gap-2">
                          <dt className="text-[var(--color-text-tertiary)]">{field}</dt>
                          <dd className="m-0 truncate font-mono" title={String(value ?? '')}>
                            {value === null || value === undefined ? '—' : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </>
            )}
            <label className="field-label">
              <span>{t('media:subtitleModeLabel')}</span>
              <select
                className="field-input"
                value={subtitleMode}
                disabled={effectiveLocked}
                onChange={(e) => setSubtitleMode(e.target.value as SubtitleMode)}
              >
                <option value="HARD_SUB">{t('media:subtitleHard')}</option>
                <option value="SOFT_SUB">{t('media:subtitleSoft')}</option>
              </select>
            </label>
            <SubHead>{t('media:renderPrep.positionSection')}</SubHead>
            <label className="field-label">
              <span>{t('media:renderPrep.position')}</span>
              <select
                className="field-input"
                value={position}
                onChange={(e) => setPosition(e.target.value as SubtitlePosition)}
                disabled={effectiveLocked || subtitleMode === 'SOFT_SUB' || appearanceDead('subtitlePosition')}
              >
                <option value="TOP">{t('media:renderPrep.top')}</option>
                <option value="CENTER">{t('media:renderPrep.center')}</option>
                <option value="BOTTOM">{t('media:renderPrep.bottom')}</option>
              </select>
            </label>
            <label className="field-label">
              <span>{t('media:renderPrep.offset', { value: offset })}</span>
              <input
                type="range"
                min={-30}
                max={30}
                value={offset}
                disabled={effectiveLocked || subtitleMode === 'SOFT_SUB' || appearanceDead('verticalOffsetPercent')}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
            </label>
            <SubHead>{t('media:renderPrep.aspectSection')}</SubHead>
            {/* OUTPUT-ASPECT (docs/97 §19.19): the worker reframes (blur-pad)
                BEFORE burning subtitles — mode-independent, so it is NOT
                disabled for SOFT_SUB. */}
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={t('media:renderPrep.aspectSection')}
              data-testid="render-prep-aspect"
            >
              {(['ORIGINAL', '16:9', '9:16', '4:3', '1:1'] as OutputAspectRatio[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`render-prep-aspect-${value.replace(':', 'x')}`}
                  aria-pressed={outputAspectRatio === value}
                  disabled={effectiveLocked}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    outputAspectRatio === value
                      ? 'border-[var(--color-media)] bg-[var(--color-media)] text-white'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)]'
                  }`}
                  onClick={() => setOutputAspectRatio(value)}
                >
                  {value === 'ORIGINAL' ? t('media:renderPrep.aspectOriginal') : value}
                </button>
              ))}
            </div>
            {outputAspectRatio !== 'ORIGINAL' && (
              <p className="field-help m-0">{t('media:renderPrep.aspectHint')}</p>
            )}

            <SubHead>{t('media:renderPrep.colorSection')}</SubHead>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={backgroundBox}
                disabled={effectiveLocked || subtitleMode === 'SOFT_SUB' || appearanceDead('backgroundBox')}
                onChange={(e) => setBackgroundBox(e.target.checked)}
              />
              {t('media:renderPrep.backgroundBox')}
            </label>
            {backgroundBox && subtitleMode === 'HARD_SUB' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field-label">
                  <span>{t('media:renderPrep.backgroundColor')}</span>
                  <input
                    type="color"
                    className="field-input h-9 w-full p-1"
                    data-testid="render-prep-background-color"
                    value={backgroundColor}
                    disabled={effectiveLocked || appearanceDead('backgroundColor')}
                    onChange={(e) => setBackgroundColor(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  <span>{t('media:renderPrep.backgroundAlpha', { value: backgroundAlpha })}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={backgroundAlpha}
                    disabled={effectiveLocked || appearanceDead('backgroundColor')}
                    data-testid="render-prep-background-alpha"
                    onChange={(e) => setBackgroundAlpha(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
            {backgroundBox && subtitleMode === 'HARD_SUB' && (
              <p className="field-help m-0">{t('media:renderPrep.bgColorStyleNote')}</p>
            )}
            {subtitleMode === 'HARD_SUB' && (
              <label className="field-label">
                <span>{t('media:renderPrep.textColor')}</span>
                <input
                  type="color"
                  className="field-input h-9 w-full p-1"
                  data-testid="render-prep-text-color"
                  value={textColor}
                  disabled={effectiveLocked || appearanceDead('textColor')}
                  onChange={(e) => setTextColor(e.target.value)}
                />
              </label>
            )}
            {/* 2026-09 dual-event: outline renders above the box (Layer 1),
                so it stays enabled in box mode. Old workers are gated at
                claim (SUBTITLE_BOX_OUTLINE), never silently dropped. */}
            {subtitleMode === 'HARD_SUB' && !ownedByStyle && (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="outline-controls">
                <label className="field-label">
                  <span>{t('media:renderPrep.outlineWidth')}</span>
                  <input
                    type="number"
                    className="field-input"
                    min={0}
                    max={8}
                    step={1}
                    value={outlineWidth ?? ''}
                    placeholder={t('media:renderPrep.typographyDefault')}
                    disabled={outlineDisabled || effectiveLocked}
                    data-testid="render-prep-outline-width"
                    onChange={(e) =>
                      setOutlineWidth(e.target.value === '' ? null : Number(e.target.value))
                    }
                  />
                </label>
                <label className="field-label">
                  <span>{t('media:renderPrep.outlineColor')}</span>
                  <input
                    type="color"
                    className="field-input h-9 w-full p-1"
                    data-testid="render-prep-outline-color"
                    value={/^#[0-9A-Fa-f]{6}$/.test(outlineColor ?? '') ? (outlineColor as string) : '#000000'}
                    disabled={outlineDisabled || effectiveLocked}
                    onChange={(e) => setOutlineColor(e.target.value.toUpperCase())}
                  />
                </label>
              </div>
            )}
            {subtitleMode === 'HARD_SUB' && !ownedByStyle && outlineDisabled && !effectiveLocked && (
              <p className="field-help m-0" data-testid="outline-box-warning">
                {t('media:renderPrep.outlineBoxWarning')}
              </p>
            )}
            {subtitleMode === 'HARD_SUB' && (
              <p className="field-help m-0">{t('media:renderPrep.textColorNote')}</p>
            )}
            {subtitleMode === 'SOFT_SUB' && (
              <p className="field-help m-0">{t('media:renderPrep.softSubWarning')}</p>
            )}
          </div>
        </RenderGroup>

        {/* Phase 6 — subtitle presentation (docs/19 §1.8.1): typography and mask
            are HARD_SUB-only — disabled + labeled for SOFT_SUB (the player
            controls mov_text presentation; the backend rejects them with 422). */}
        <RenderGroup index="③" title={t('media:renderPrep.subtitleLayerContentTitle')} open={!effectiveLocked || isSummary || isEditingReapply}>
          <div className="space-y-3">
            {isSummary && (
              <div
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5 text-xs text-[var(--color-text-secondary)]"
                data-testid="summary-grouping-hint"
              >
                {t('media:renderPrep.summaryGroupingHint')}
              </div>
            )}
            <label className="field-label">
              <span>{t('media:renderPrep.displayMode')}</span>
              <select
                className="field-input"
                value={displayMode}
                disabled={effectiveLocked}
                onChange={(e) => setDisplayMode(e.target.value as SubtitleDisplayMode)}
              >
                <option value="SENTENCE">{t('media:renderPrep.displayModeSentence')}</option>
                <option value="PHRASE">{t('media:renderPrep.displayModePhrase')}</option>
                <option value="WORD">{t('media:renderPrep.displayModeWord')}</option>
                <option value="CHARACTERS">{t('media:renderPrep.displayModeCharacters')}</option>
              </select>
            </label>
            {displayMode === 'PHRASE' && (
              <label className="field-label">
                <span>{t('media:renderPrep.wordsPerPhrase')}</span>
                <input
                  type="number"
                  className="field-input"
                  min={3}
                  max={10}
                  value={wordsPerPhrase}
                  disabled={effectiveLocked}
                  onChange={(e) => setWordsPerPhrase(Number(e.target.value))}
                />
              </label>
            )}
            {displayMode === 'CHARACTERS' && (
              <MaxCharactersPerCueField
                value={maxCharactersPerCue}
                locked={effectiveLocked}
                invalid={charactersInvalid}
                onChange={setMaxCharactersPerCue}
              />
            )}

            <div
              className={`space-y-3 ${typographyMaskBlockClass(subtitleMode)}`}
              data-testid="presentation-typography-mask"
            >
              <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                {t('media:renderPrep.typography')}
              </h4>
              <label className="field-label">
                <span>{t('media:renderPrep.fontSize')}</span>
                <input
                  type="number"
                  className="field-input"
                  min={16}
                  max={120}
                  value={fontSize ?? ''}
                  placeholder={t('media:renderPrep.typographyDefault')}
                  disabled={effectiveLocked || subtitleMode === 'SOFT_SUB'}
                  onChange={(e) => setFontSize(e.target.value === '' ? null : Math.max(16, Math.min(120, Number(e.target.value))))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bold ?? false}
                  disabled={effectiveLocked || subtitleMode === 'SOFT_SUB'}
                  onChange={(e) => setBold(e.target.checked)}
                />
                {t('media:renderPrep.bold')}
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="field-label">
                  <span>{t('media:renderPrep.outlineWidth')}</span>
                  <input
                    type="number"
                    min={0}
                    max={8}
                    className="field-input"
                    value={outlineWidth ?? ''}
                    placeholder={t('media:renderPrep.typographyDefault')}
                    disabled={outlineDisabled}
                    onChange={(e) => setOutlineWidth(
                      e.target.value === '' ? null : Math.max(0, Math.min(8, Number(e.target.value))),
                    )}
                  />
                </label>
                <label className="field-label">
                  <span>{t('media:renderPrep.outlineColor')}</span>
                  <input
                    type="color"
                    className="field-input h-9 w-full p-1"
                    value={outlineColor ?? '#000000'}
                    disabled={outlineDisabled}
                    onChange={(e) => setOutlineColor(e.target.value.toUpperCase())}
                  />
                </label>
              </div>
              {(effective ? effective.boxMode : backgroundBox) && !ownedByStyle && (
                <p className="field-help m-0">{t('media:renderPrep.outlineBoxWarning')}</p>
              )}
            </div>
            {subtitleMode === 'SOFT_SUB' && (
              <p className="field-help m-0">{t('media:renderPrep.softSubPresentationWarning')}</p>
            )}
          </div>
        </RenderGroup>

        <RenderGroup
          index="④"
          title={t('media:renderPrep.maskLayerTitle')}
          open={!effectiveLocked || coverEnabled}
          testid="finish-mask-layer-block"
        >
          <p className="field-help mt-0 mb-3">{t('media:renderPrep.maskLayerHint')}</p>
          <CoverLayersEditor
            enabled={coverEnabled}
            layers={coverLayers}
            locked={effectiveLocked || subtitleMode === 'SOFT_SUB'}
            selectedLayerId={selectedCoverLayerId}
            onSelectedLayerChange={setSelectedCoverLayerId}
            testidPrefix="mask"
            onChange={({ enabled, layers }) => {
              setCoverEnabled(enabled)
              setCoverLayers(layers)
            }}
          />
          {subtitleMode === 'SOFT_SUB' && (
            <p className="field-help mt-3 mb-0">{t('media:renderPrep.softSubCoverWarning')}</p>
          )}
        </RenderGroup>

        {/* Phase 6 — audio presentation (docs/19 §1.8.1): engine-neutral gains /
            ducking / tempo compiled by the backend AUDIO_MIX stage. Embedded
            (Finish & Render) mode is controlled by the section's shared state;
            standalone mode reads the internal hydrated state. */}
        <RenderGroup
          index="⑤"
          title={t('media:renderPrep.audioTitle')}
          open={!locked}
          testid={embeddedAudio ? 'finish-audio-block' : undefined}
        >
          {audioAvailable ? (
            <AudioPresentationConfig
              audio={effectiveAudio}
              locked={locked || isEditingReapply}
              collapsible={false}
              onChange={(v) => {
                if (embeddedAudio) {
                  onAudioChange?.(v)
                  return
                }
                setOriginalGainDb(v.originalGainDb)
                setTtsGainDb(v.ttsGainDb)
                setDuckingEnabled(v.duckingEnabled)
                setDuckingGainDb(v.duckingGainDb)
                setTtsTempo(v.ttsTempo)
              }}
            />
          ) : (
            <p className="field-help m-0">{t('media:renderPrep.audioMixSkippedNote')}</p>
          )}
        </RenderGroup>
      </div>
      </div>
    </div>
  )
}

export type RenderPrepVoiceChange = {
  provider: ProviderConfig | undefined
  voiceRowId: string
  deps: {
    selectVoice: { isPending: boolean; mutateAsync: (body: { providerId: string | null; voiceId: string | null }) => Promise<unknown> }
  }
}

/**
 * Phase C — Render Preparation voice change. Sends the authoritative pair
 * (provider row id + voice ROW id) through the backend endpoint — never the
 * legacy voice_id string (C5 P1 fix). Refuses to emit a partial pair when the
 * provider is unknown (BA re-review vòng 2 P2 fix). Exported as a pure helper
 * so tests can assert the exact payload.
 */
export async function runRenderPrepVoiceChange(change: RenderPrepVoiceChange) {
  const { deps } = change
  if (deps.selectVoice.isPending) return
  if (!change.provider) {
    throw new Error('partial TTS binding: provider is required for a voice change')
  }
  await deps.selectVoice.mutateAsync({
    providerId: change.provider.id,
    voiceId: change.voiceRowId,
  })
}
