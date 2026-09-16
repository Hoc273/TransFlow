import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_PREVIEW_FONT_SIZE,
  layerAnchorLinePercent,
  overlayTopPercent,
  subtitleAnchorLinePercent,
} from '@/lib/media/previewProjection'
import type { PresentationLayer } from '@/types/media'

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

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9A-Fa-f]{6})$/.exec(hex)
  if (!match) return `rgba(0, 0, 0, ${alpha})`
  const value = Number.parseInt(match[1], 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function SubtitlePreviewFrame({
  values,
  aspect: aspectProp,
  onAspectChange,
  backgroundUrl,
  backgroundKind = 'video',
}: SubtitlePreviewFrameProps) {
  const { t } = useTranslation('media')
  const [internalAspect, setInternalAspect] = useState<PreviewAspect>('16:9')
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
  }
  if (values.subtitlePosition === 'BOTTOM') {
    subtitleStyle.bottom = `${100 - linePercent}%`
  } else {
    // TOP/CENTER anchor the text TOP edge at the line (worker Alignment 8).
    subtitleStyle.top = `${linePercent}%`
  }

  const textBackground = hexToRgba(values.backgroundColor, values.backgroundAlpha / 100)

  return (
    <div className="space-y-2" data-testid="preset-preview">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">
          {t('media:workflowPresetAdmin.previewTitle')}
        </span>
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
              {a === 'ORIGINAL' ? t('media:renderPrep.aspectOriginalShort') : a}
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)]"
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
                  src={backgroundUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
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
                  src={backgroundUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="max-h-full max-w-full object-contain"
                  data-testid="preset-preview-fit-fg"
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
          <div className="preset-preview-video" />
        )}
        <div
          className="preset-preview-old-sub"
          data-testid="preset-preview-old-sub"
          style={subtitleStyle}
        >
          {t('media:renderPrep.oldSubtitleSample')}
        </div>
        {/* V2 layers first (authoritative), then the legacy single-mask
            fallback — mirroring the worker: layers present ⇒ mask inert. */}
        {activeLayers.map((layer) => {
          const anchorLine = layerAnchorLinePercent(layer.anchor, linePercent)
          const isBlur = layer.type === 'BLUR'
          return (
            <div
              key={layer.id}
              className="preset-preview-mask"
              data-testid={`preset-preview-layer-${layer.id}`}
              data-style={layer.type}
              style={{
                top: `${overlayTopPercent(anchorLine, layer.geometry.heightPercent)}%`,
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
        })}
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
          className="preset-preview-subtitle"
          data-testid="preset-preview-subtitle"
          style={{
            ...subtitleStyle,
            background: values.backgroundBox ? textBackground : undefined,
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
    </div>
  )
}
