import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconMoon,
  IconPlayerPause,
  IconPlayerPlay,
  IconRotateClockwise,
  IconSun,
} from '@tabler/icons-react'
import {
  DEFAULT_PREVIEW_FONT_SIZE,
  clampOverlayCenterPercent,
  layerAnchorLinePercent,
  overlayTopPercent,
  snapLayerAnchor,
  snapSubtitlePlacement,
  subtitleAnchorLinePercent,
} from '@/lib/media/previewProjection'
import type { PresentationLayer, PresentationLayerAnchor, SubtitlePosition } from '@/types/media'

/**
 * PRESET-VIZ (docs/97 §19.16) — live WYSIWYG preview for the preset editor.
 *
 * The frame mirrors the render contract geometry (worker ffmpeg.py): the
 * subtitle anchor line is `base(position) + verticalOffsetPercent` clamped to
 * [3, 95]; the mask centers on that line with `heightPercent/2`; layer order
 * is fixed — old burned-in subtitle (under) → cover layers (v2, each with an
 * independent anchor) → new subtitle (on top), exactly like `_chain_mask` /
 * `_build_layer_filters` in one encode pass.
 *
 * The aspect selector (16:9 · 9:16 · 4:3 · 1:1) is PREVIEW-ONLY: it never
 * leaves this component, nothing is persisted, and the rendered video keeps
 * its original ratio (CT3 reserve — media pipeline has no reframe).
 */
export type PreviewAspect = '16:9' | '9:16' | '4:3' | '1:1'

export type SubtitlePreviewValues = {
  subtitlePosition: 'TOP' | 'CENTER' | 'BOTTOM'
  verticalOffsetPercent: number
  backgroundBox: boolean
  /** #RRGGBB text background color. */
  backgroundColor: string
  /** 0..100 text background opacity. */
  backgroundAlpha: number
  /** #RRGGBB text color. */
  textColor?: string
  /** PlayRes units (16..120); null = style default 44. */
  fontSize: number | null
  bold: boolean
  /** Optional font family. */
  fontFamily?: string | null
  /** Optional glyph outline used when the background box is off. */
  outlineWidth?: number | null
  outlineColor?: string | null
  /**
   * V2 cover layers — when non-empty these are authoritative and the legacy
   * single-mask fields below are ignored (worker precedence, no double-burn).
   */
  layers?: PresentationLayer[] | null
  /** Legacy v1 single-mask fallback (kept for old callers/tests). */
  maskEnabled?: boolean
  maskStyle?: 'SOLID' | 'BLUR'
  /** 20..100. */
  maskWidth?: number
  /** 5..50. */
  maskHeight?: number
  /** 0..100. */
  maskOpacity?: number
  /** 2..20 (BLUR only). */
  maskBlurRadius?: number
  /** #RRGGBB cover color. */
  maskColor?: string
}

/**
 * OUTPUT-ASPECT (docs/97 §19.19): when `aspect` is controlled (preset editor)
 * the selector WRITES the real `outputAspectRatio` field — ORIGINAL keeps the
 * source frame (drawn at 16:9 for display only), anything else mirrors the
 * blur-pad reframe the worker applies. Uncontrolled callers keep the old
 * preview-only behavior.
 */
export type SubtitlePreviewFrameProps = {
  values: SubtitlePreviewValues
  aspect?: PreviewAspect | 'ORIGINAL'
  onAspectChange?: (aspect: PreviewAspect | 'ORIGINAL') => void
  onSubtitlePlacementChange?: (
    position: SubtitlePosition,
    verticalOffsetPercent: number,
  ) => void
  onLayerAnchorChange?: (layerId: string, anchor: PresentationLayerAnchor) => void
  onLayerPositionChange?: (layerId: string, xPercent: number, yPercent: number) => void
  selectedLayerId?: string | null
  onSelectedLayerChange?: (layerId: string) => void
  /** Local calibration media (object URL) — never persisted, memory-only. */
  backgroundUrl?: string | null
  backgroundKind?: 'video' | 'image'
}

const ASPECTS: PreviewAspect[] = ['16:9', '9:16', '4:3', '1:1']

/** Height clamps per aspect keep the frame inside the modal on small screens
 * while the computed width preserves the exact ratio (no distortion). */
const ASPECT_LAYOUT: Record<PreviewAspect, { ratio: number; maxHeightVh: number }> = {
  '16:9': { ratio: 16 / 9, maxHeightVh: 58 },
  '9:16': { ratio: 9 / 16, maxHeightVh: 54 },
  '4:3': { ratio: 4 / 3, maxHeightVh: 56 },
  '1:1': { ratio: 1, maxHeightVh: 58 },
}

const DEFAULT_FONT_SIZE = DEFAULT_PREVIEW_FONT_SIZE

function hexToRgba(hex: string | undefined | null, alpha: number): string {
  if (!hex) return `rgba(0, 0, 0, ${alpha})`
  const clean = hex.trim()
  const match8 = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})$/.exec(clean)
  if (match8) {
    const r = Number.parseInt(match8[1].slice(0, 2), 16)
    const g = Number.parseInt(match8[1].slice(2, 4), 16)
    const b = Number.parseInt(match8[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const match6 = /^#([0-9A-Fa-f]{6})$/.exec(clean)
  if (match6) {
    const value = Number.parseInt(match6[1], 16)
    const r = (value >> 16) & 0xff
    const g = (value >> 8) & 0xff
    const b = value & 0xff
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return `rgba(0, 0, 0, ${alpha})`
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

function PresetPreviewLayer({
  layer,
  subtitleLinePercent,
  selected,
  label,
  onSelect,
  onAnchorChange,
  onPositionChange,
}: {
  layer: PresentationLayer
  subtitleLinePercent: number
  selected: boolean
  label: string
  onSelect?: () => void
  onAnchorChange?: (anchor: PresentationLayerAnchor) => void
  onPositionChange?: (xPercent: number, yPercent: number) => void
}) {
  const dragDelta = useRef<{ xPercent: number; yPercent: number } | null>(null)
  const isBlur = layer.type === 'BLUR'
  const centerXPercent = clampOverlayCenterPercent(
    layer.geometry.xPercent ?? 50,
    layer.geometry.widthPercent,
  )
  const centerYPercent = clampOverlayCenterPercent(
    layer.geometry.yPercent
      ?? layerAnchorLinePercent(layer.anchor, subtitleLinePercent),
    layer.geometry.heightPercent,
  )
  const interactive = Boolean(onPositionChange || onAnchorChange)

  return (
    <div
      className={`preset-preview-mask ${interactive ? 'preview-direct-manipulation' : ''} ${selected ? 'selected' : ''}`}
      data-testid={`preset-preview-layer-${layer.id}`}
      data-style={layer.type}
      data-selected={selected || undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? label : undefined}
      tabIndex={interactive ? 0 : undefined}
      onPointerDown={(event) => {
        if (!interactive) return
        event.preventDefault()
        onSelect?.()
        const pointer = pointerPositionPercent(event)
        dragDelta.current = {
          xPercent: pointer.xPercent - centerXPercent,
          yPercent: pointer.yPercent - centerYPercent,
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (dragDelta.current === null) return
        const pointer = pointerPositionPercent(event)
        const xPercent = clampOverlayCenterPercent(
          pointer.xPercent - dragDelta.current.xPercent,
          layer.geometry.widthPercent,
        )
        const yPercent = clampOverlayCenterPercent(
          pointer.yPercent - dragDelta.current.yPercent,
          layer.geometry.heightPercent,
        )
        if (onPositionChange) {
          onPositionChange(Math.round(xPercent), Math.round(yPercent))
        } else {
          onAnchorChange?.(snapLayerAnchor(yPercent, subtitleLinePercent, layer.anchor))
        }
      }}
      onPointerUp={(event) => {
        dragDelta.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => {
        dragDelta.current = null
      }}
      style={{
        left: `${centerXPercent}%`,
        top: `${overlayTopPercent(centerYPercent, layer.geometry.heightPercent)}%`,
        width: `${layer.geometry.widthPercent}%`,
        height: `${layer.geometry.heightPercent}%`,
        background: isBlur
          ? 'rgba(0, 0, 0, 0.08)'
          : hexToRgba(
              ('color' in layer.style ? layer.style.color : '#000000') as string,
              ((('opacityPercent' in layer.style ? layer.style.opacityPercent : 0) as number) ?? 0) / 100,
            ),
        backdropFilter: isBlur
          ? `blur(${('blurRadius' in layer.style ? layer.style.blurRadius : 0) as number}px)`
          : undefined,
      }}
    />
  )
}

export function SubtitlePreviewFrame({
  values,
  aspect: aspectProp,
  onAspectChange,
  onSubtitlePlacementChange,
  onLayerAnchorChange,
  onLayerPositionChange,
  selectedLayerId,
  onSelectedLayerChange,
  backgroundUrl,
  backgroundKind = 'video',
}: SubtitlePreviewFrameProps) {
  const { t } = useTranslation('media')
  const [internalAspect, setInternalAspect] = useState<PreviewAspect>('16:9')
  const subtitleDragDelta = useRef<number | null>(null)
  const blurVideoRef = useRef<HTMLVideoElement | null>(null)
  const foregroundVideoRef = useRef<HTMLVideoElement | null>(null)
  const controlled = typeof onAspectChange === 'function'
  const selected: PreviewAspect | 'ORIGINAL' = controlled
    ? (aspectProp ?? 'ORIGINAL')
    : internalAspect
  // ORIGINAL keeps the source frame — drawn at 16:9 purely for display.
  const aspect: PreviewAspect = selected === 'ORIGINAL' ? '16:9' : selected
  const setAspect = (next: PreviewAspect | 'ORIGINAL') => {
    if (controlled) onAspectChange?.(next)
    else setInternalAspect(next as PreviewAspect)
  }

  const [canvasTheme, setCanvasTheme] = useState<'light' | 'dark'>('light')
  const [isPlaying, setIsPlaying] = useState(true)

  const handleTogglePlay = () => {
    const fg = foregroundVideoRef.current
    if (!fg) return
    if (fg.paused) {
      void fg.play()
      void blurVideoRef.current?.play()
      setIsPlaying(true)
    } else {
      fg.pause()
      blurVideoRef.current?.pause()
      setIsPlaying(false)
    }
  }

  const handleRewind = () => {
    if (foregroundVideoRef.current) foregroundVideoRef.current.currentTime = 0
    if (blurVideoRef.current) blurVideoRef.current.currentTime = 0
  }

  // Geometry math is single-sourced in lib/media/previewProjection — the same
  // contract functions the EFFECTIVE job preview consumes (draft editor maps
  // its own values onto them here; the job path passes backend-resolved ones).
  const linePercent = subtitleAnchorLinePercent(
    values.subtitlePosition,
    values.verticalOffsetPercent,
  )
  const layout = ASPECT_LAYOUT[aspect]

  const activeLayers = (values.layers ?? []).filter((layer) => layer.enabled !== false)
  const legacyMaskActive =
    activeLayers.length === 0 && values.maskEnabled === true
  const legacyMaskTopPercent =
    overlayTopPercent(linePercent, values.maskHeight ?? 12)

  const subtitleStyle: CSSProperties = {
    fontSize: `${((values.fontSize ?? DEFAULT_FONT_SIZE) / 1080) * 100}cqh`,
    fontWeight: values.bold ? 700 : 400,
    fontFamily: values.fontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    letterSpacing: '0.02em',
    ...((values.outlineWidth ?? 0) > 0
      ? {
          WebkitTextStroke: `${((values.outlineWidth ?? 2) / 1080) * 100}cqh ${values.outlineColor ?? '#000000'}`,
          paintOrder: 'stroke fill',
        }
      : {}),
  }
  if (values.subtitlePosition === 'BOTTOM') {
    subtitleStyle.bottom = `${100 - linePercent}%`
  } else {
    // TOP/CENTER anchor the text TOP edge at the line (worker Alignment 8).
    subtitleStyle.top = `${linePercent}%`
  }

  const textBackground = hexToRgba(
    values.backgroundColor || '#000000',
    ((values.backgroundAlpha ?? 80) / 100),
  )

  return (
    <div className="space-y-2" data-testid="preset-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">
          {t('media:workflowPresetAdmin.previewTitle')}
        </span>
        <div className="flex items-center gap-2">
          {backgroundUrl && backgroundKind === 'video' && (
            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-0.5">
              <button
                type="button"
                className="btn-media-secondary btn-sm p-1"
                data-testid="preset-preview-toggle-play"
                title={isPlaying ? t('media:renderPrep.videoPause') : t('media:renderPrep.videoPlay')}
                onClick={handleTogglePlay}
              >
                {isPlaying ? <IconPlayerPause size={13} /> : <IconPlayerPlay size={13} />}
              </button>
              <button
                type="button"
                className="btn-media-secondary btn-sm p-1"
                data-testid="preset-preview-rewind"
                title={t('media:renderPrep.videoRewind')}
                onClick={handleRewind}
              >
                <IconRotateClockwise size={13} className="-scale-x-100" />
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn-media-secondary btn-sm p-1 text-[var(--color-text-secondary)]"
            data-testid="preset-preview-canvas-theme"
            title={canvasTheme === 'light' ? t('media:renderPrep.previewDarkBg') : t('media:renderPrep.previewLightBg')}
            onClick={() => setCanvasTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
          >
            {canvasTheme === 'light' ? <IconMoon size={13} /> : <IconSun size={13} />}
          </button>
          <div
            className="flex rounded-lg border border-[var(--color-border)] p-0.5 text-[11px]"
            role="group"
            aria-label={t('media:workflowPresetAdmin.previewAspect')}
          >
            {(controlled ? (['ORIGINAL', '16:9', '9:16', '4:3', '1:1'] as const) : ASPECTS).map((a) => (
              <button
                key={a}
                type="button"
                data-testid={`preset-preview-aspect-${a.replace(':', 'x')}`}
                aria-pressed={selected === a}
                className={`rounded-md px-2 py-1 ${
                  selected === a
                    ? 'bg-[var(--color-media)] text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)]'
                }`}
                onClick={() => setAspect(a)}
              >
                {a === 'ORIGINAL' ? t('media:renderPrep.aspectOriginal') : a}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`relative mx-auto overflow-hidden rounded-xl border border-[var(--color-border)] ${canvasTheme === 'dark' ? 'bg-slate-900' : 'bg-slate-100'}`}
        data-testid="preset-preview-frame"
        data-aspect={selected}
        data-ratio={layout.ratio}
        style={{
          // CSS `<ratio>` — a bare number is valid (N/1) and equals
          // width/height; the "16:9" colon form is NOT valid CSS and would be
          // dropped by the browser, collapsing the frame (all children are
          // absolutely positioned → height 0).
          aspectRatio: layout.ratio,
          width: `min(100%, calc(${layout.maxHeightVh}vh * ${layout.ratio}))`,
          maxHeight: `${layout.maxHeightVh}vh`,
          containerType: 'size',
        }}
      >
        {/* OUTPUT-ASPECT blur-pad visualization (docs/97 §19.19): calibration
            media (memory-only object URL) renders as a blurred cover backdrop
            with an undistorted fit copy centered — the same split/scale/overlay
            chain the worker applies. Without media the gradient stands in. */}
        {backgroundUrl ? (
          <>
            <div
              className="absolute inset-0 overflow-hidden"
              data-testid="preset-preview-blur-bg"
            >
              {backgroundKind === 'video' ? (
                <video
                  ref={blurVideoRef}
                  src={backgroundUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-hidden="true"
                  className="h-full w-full object-cover blur-xl"
                />
              ) : (
                <img
                  src={backgroundUrl}
                  alt=""
                  className="h-full w-full object-cover blur-xl"
                />
              )}
            </div>
            <div className="absolute inset-0 grid place-items-center">
              {backgroundKind === 'video' ? (
                <video
                  ref={foregroundVideoRef}
                  src={backgroundUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="max-h-full max-w-full object-contain"
                  data-testid="preset-preview-fit-fg"
                  onPlay={() => {
                    setIsPlaying(true)
                    void blurVideoRef.current?.play()
                  }}
                  onPause={() => {
                    setIsPlaying(false)
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
              ) : (
                <img
                  src={backgroundUrl}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  data-testid="preset-preview-fit-fg"
                />
              )}
            </div>
          </>
        ) : (
          <div className={`preset-preview-video ${canvasTheme === 'dark' ? 'dark-canvas' : ''}`} />
        )}
        {(activeLayers.length > 0 || legacyMaskActive) && (
          <div
            className="preset-preview-old-sub"
            data-testid="preset-preview-old-sub"
            style={subtitleStyle}
          >
            {t('media:renderPrep.oldSubtitleSample')}
          </div>
        )}
        {/* V2 layers first (authoritative), then the legacy single-mask
            fallback — mirroring the worker: layers present ⇒ mask inert. */}
        {activeLayers.map((layer) => (
          <PresetPreviewLayer
            key={layer.id}
            layer={layer}
            subtitleLinePercent={linePercent}
            selected={selectedLayerId === layer.id}
            label={t('media:renderPrep.dragCoverLayer')}
            onSelect={onSelectedLayerChange ? () => onSelectedLayerChange(layer.id) : undefined}
            onAnchorChange={onLayerAnchorChange
              ? (anchor) => onLayerAnchorChange(layer.id, anchor)
              : undefined}
            onPositionChange={onLayerPositionChange
              ? (xPercent, yPercent) => onLayerPositionChange(layer.id, xPercent, yPercent)
              : undefined}
          />
        ))}
        {legacyMaskActive && (
          <div
            className="preset-preview-mask"
            data-testid="preset-preview-mask"
            data-style={values.maskStyle}
            style={{
              top: `${legacyMaskTopPercent}%`,
              width: `${values.maskWidth ?? 85}%`,
              height: `${values.maskHeight ?? 12}%`,
              background: hexToRgba(values.maskColor ?? '#000000', (values.maskOpacity ?? 60) / 100),
              backdropFilter:
                values.maskStyle === 'BLUR' ? `blur(${values.maskBlurRadius ?? 12}px)` : undefined,
            }}
          />
        )}
        <div
          className={`preset-preview-subtitle ${onSubtitlePlacementChange ? 'preview-direct-manipulation' : ''}`}
          data-testid="preset-preview-subtitle"
          style={{
            ...subtitleStyle,
            background: values.backgroundBox ? textBackground : undefined,
            padding: values.backgroundBox ? '0.25em 0.65em' : '0.1em 0.2em',
            borderRadius: values.backgroundBox ? '0.35em' : undefined,
            boxShadow: values.backgroundBox ? '0 2px 8px rgba(0, 0, 0, 0.25)' : undefined,
          }}
          role={onSubtitlePlacementChange ? 'button' : undefined}
          aria-label={onSubtitlePlacementChange ? t('media:renderPrep.dragSubtitle') : undefined}
          tabIndex={onSubtitlePlacementChange ? 0 : undefined}
          onPointerDown={(event) => {
            if (!onSubtitlePlacementChange) return
            event.preventDefault()
            subtitleDragDelta.current = pointerLinePercent(event) - linePercent
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (subtitleDragDelta.current === null || !onSubtitlePlacementChange) return
            const next = snapSubtitlePlacement(
              pointerLinePercent(event) - subtitleDragDelta.current,
            )
            onSubtitlePlacementChange(next.position, next.verticalOffsetPercent)
          }}
          onPointerUp={(event) => {
            subtitleDragDelta.current = null
            event.currentTarget.releasePointerCapture?.(event.pointerId)
          }}
          onPointerCancel={() => {
            subtitleDragDelta.current = null
          }}
        >
          <span className="preset-preview-subtitle-text" data-testid="preset-preview-subtitle-text" style={{ color: values.textColor }}>
            {t('media:renderPrep.subtitleSample')}
          </span>
        </div>
      </div>

      {legacyMaskActive && (
        <p className="m-0 text-[11px] text-[var(--color-text-tertiary)]" data-testid="preset-preview-padding-note">
          {t('media:renderPrep.maskPaddingReserved')}
        </p>
      )}

      <p className="m-0 text-[11px] text-[var(--color-text-tertiary)]">
        {controlled
          ? t('media:workflowPresetAdmin.previewAspectReal')
          : t('media:workflowPresetAdmin.previewNote')}
      </p>
      {(onSubtitlePlacementChange || onLayerAnchorChange || onLayerPositionChange) && (
        <p className="m-0 text-[11px] text-[var(--color-text-tertiary)]">
          {t('media:renderPrep.previewDragHint')}
        </p>
      )}
    </div>
  )
}
