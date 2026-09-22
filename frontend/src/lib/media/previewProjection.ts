// @ts-nocheck
import type {
  PresentationLayer,
  PresentationLayerAnchor,
  SubtitleMaskConfig,
  SubtitlePosition,
} from '@/types/media'

/**
 * Unified preview projection (docs/97 §19.17 §10 + D17) — pure contract math
 * shared by the job preview and the preset-editor frame.
 *
 * The EFFECTIVE entry point (`projectEffectivePreview`) consumes ONLY the
 * backend-computed projection — `resolvedLinePercent` is taken verbatim, the
 * raw draft (position/offset form fields) never reaches it. Styled jobs are
 * text-locked BOTTOM with an inert offset (F-07). Overlay geometry mirrors the
 * worker contract exactly: anchor line = base{TOP:8, CENTER:50, BOTTOM:88} for
 * fixed anchors, the effective subtitle line for SUBTITLE; top = clamp(line −
 * heightPercent/2); layers sort zIndex ASC then id ASC and, when non-empty,
 * replace the v1 mask (worker precedence — no double-burn).
 */

export const SUBTITLE_BASE_LINE_PERCENT = { TOP: 8, CENTER: 50, BOTTOM: 88 } as const

export const LINE_PERCENT_MIN = 3
export const LINE_PERCENT_MAX = 95

export const DEFAULT_PREVIEW_FONT_SIZE = 44
/** ASS PlayResY is fixed at 1080 (Spring AssGenerator / B1.0). */
export const PLAY_RES_Y = 1080

export function clampLinePercent(linePercent: number): number {
  return Math.max(LINE_PERCENT_MIN, Math.min(LINE_PERCENT_MAX, linePercent))
}

/** Effective subtitle line: base(position) + offset, clamped — mirrors the worker. */
export function subtitleAnchorLinePercent(
  position: 'TOP' | 'CENTER' | 'BOTTOM',
  verticalOffsetPercent: number,
): number {
  return clampLinePercent(SUBTITLE_BASE_LINE_PERCENT[position] + verticalOffsetPercent)
}

/** Convert a dragged preview line back to the existing position + offset wire fields. */
export function snapSubtitlePlacement(linePercent: number): {
  position: SubtitlePosition
  verticalOffsetPercent: number
} {
  const target = clampLinePercent(linePercent)
  const positions: SubtitlePosition[] = ['TOP', 'CENTER', 'BOTTOM']
  const position = positions.reduce((best, candidate) =>
    Math.abs(target - SUBTITLE_BASE_LINE_PERCENT[candidate])
      < Math.abs(target - SUBTITLE_BASE_LINE_PERCENT[best])
      ? candidate
      : best,
  )
  return {
    position,
    verticalOffsetPercent: Math.max(
      -30,
      Math.min(30, Math.round(target - SUBTITLE_BASE_LINE_PERCENT[position])),
    ),
  }
}

/** Snap a dragged cover to the closest semantic anchor supported by V2. */
export function snapLayerAnchor(
  linePercent: number,
  resolvedSubtitleLinePercent: number,
  current: PresentationLayerAnchor,
): PresentationLayerAnchor {
  const target = clampLinePercent(linePercent)
  // Keep the current anchor on exact ties; otherwise prefer explicit frame
  // anchors before SUBTITLE when both occupy the same line (for example a
  // bottom subtitle at 88%). This makes dragging to an edge unsurprising.
  const anchors: PresentationLayerAnchor[] = [current, 'TOP', 'CENTER', 'BOTTOM', 'SUBTITLE']
  return anchors.reduce((best, candidate) =>
    Math.abs(target - layerAnchorLinePercent(candidate, resolvedSubtitleLinePercent))
      < Math.abs(target - layerAnchorLinePercent(best, resolvedSubtitleLinePercent))
      ? candidate
      : best,
  )
}

/** Fixed anchors ignore any subtitle offset entirely (F-09). */
export function layerAnchorLinePercent(
  anchor: PresentationLayerAnchor,
  resolvedLinePercent: number,
): number {
  if (anchor === 'SUBTITLE') return resolvedLinePercent
  return SUBTITLE_BASE_LINE_PERCENT[anchor]
}

/**
 * Overlay top edge in percent of frame height — identical arithmetic to the
 * worker's pixel formula y=round(H·(line−hp/2)/100) expressed in percent space.
 */
export function overlayTopPercent(centerPercent: number, heightPercent: number): number {
  return Math.max(0, Math.min(100 - heightPercent, centerPercent - heightPercent / 2))
}

export function overlayLeftPercent(centerPercent: number, widthPercent: number): number {
  return Math.max(0, Math.min(100 - widthPercent, centerPercent - widthPercent / 2))
}

export function clampOverlayCenterPercent(centerPercent: number, sizePercent: number): number {
  return Math.max(sizePercent / 2, Math.min(100 - sizePercent / 2, centerPercent))
}

export type PreviewOverlayStyle =
  | { kind: 'mask'; style: 'SOLID' | 'BLUR'; color: string; opacityPercent: number; blurRadius: number | null }
  | { kind: 'layer'; layerType: 'SOLID' | 'BLUR'; color: string | null; opacityPercent: number | null; blurRadius: number | null }

export type PreviewOverlay = {
  /** Stable identity for keyed rendering (mask or layer id). */
  key: string
  leftPercent: number
  topPercent: number
  centerXPercent: number
  centerYPercent: number
  widthPercent: number
  heightPercent: number
  style: PreviewOverlayStyle
}

export type PreviewTextPlacement = {
  /**
   * true ⇒ anchor via CSS bottom = (100 − line)% (worker Alignment 2);
   * false ⇒ CSS top = line% (worker Alignment 8).
   */
  lockedBottom: boolean
  bottomPercent: number | null
  topPercent: number | null
  fontSizeCqh: number
  fontWeight: 700 | 400
}

export type PreviewProjection = {
  linePercent: number
  text: PreviewTextPlacement
  overlays: PreviewOverlay[]
}

/**
 * EFFECTIVE-only preview source. Every field comes from the backend-computed
 * projection (RenderConfig.effective), the assigned style snapshot, or the
 * stored render config read-back — never from unsaved editor state.
 */
export type EffectivePreviewSource = {
  ownedByStyle: boolean
  /** Backend-clamped subtitle line ([3..95]; 88 when ownedByStyle — F-07). */
  resolvedLinePercent: number
  boxMode: boolean
  /** Stored render-config position (backend state — NOT unsaved draft input). */
  subtitlePosition: 'TOP' | 'CENTER' | 'BOTTOM'
  /** PlayRes units (styled snapshot font_size or typography override); null → default. */
  fontSize: number | null
  bold: boolean
  /** #RRGGBB (effective text colour on the legacy path; styled snapshot owns it otherwise). */
  textColor: string | null
  /** v1 single mask — ignored when layers are present (worker precedence). */
  mask?: SubtitleMaskConfig | null
  layers?: PresentationLayer[] | null
}

export function projectLayers(layers: PresentationLayer[], resolvedLinePercent: number): PreviewOverlay[] {
  const ordered = [...layers].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id))
  return ordered.map((layer) => {
    const centerXPercent = clampOverlayCenterPercent(
      layer.geometry.xPercent ?? 50,
      layer.geometry.widthPercent,
    )
    const centerYPercent = clampOverlayCenterPercent(
      layer.geometry.yPercent
        ?? layerAnchorLinePercent(layer.anchor, resolvedLinePercent),
      layer.geometry.heightPercent,
    )
    return {
      key: layer.id,
      leftPercent: overlayLeftPercent(centerXPercent, layer.geometry.widthPercent),
      topPercent: overlayTopPercent(centerYPercent, layer.geometry.heightPercent),
      centerXPercent,
      centerYPercent,
      widthPercent: layer.geometry.widthPercent,
      heightPercent: layer.geometry.heightPercent,
      style:
        layer.type === 'SOLID'
          ? {
              kind: 'layer' as const,
              layerType: 'SOLID' as const,
              color: layer.style.color ?? null,
              opacityPercent: layer.style.opacityPercent,
              blurRadius: null,
            }
          : {
              kind: 'layer' as const,
              layerType: 'BLUR' as const,
              color: null,
              opacityPercent: null,
              blurRadius: layer.style.blurRadius,
            },
    }
  })
}

function projectMask(mask: SubtitleMaskConfig, resolvedLinePercent: number): PreviewOverlay[] {
  if (!mask.enabled) return []
  const centerXPercent = 50
  const centerYPercent = clampOverlayCenterPercent(
    resolvedLinePercent,
    mask.heightPercent,
  )
  return [
    {
      key: 'mask',
      leftPercent: overlayLeftPercent(centerXPercent, mask.widthPercent),
      topPercent: overlayTopPercent(centerYPercent, mask.heightPercent),
      centerXPercent,
      centerYPercent,
      widthPercent: mask.widthPercent,
      heightPercent: mask.heightPercent,
      style: {
        kind: 'mask',
        style: mask.style ?? 'SOLID',
        color: mask.color ?? '#000000',
        opacityPercent: mask.opacityPercent,
        blurRadius: mask.style === 'BLUR' ? (mask.blurRadius ?? null) : null,
      },
    },
  ]
}

/**
 * Projects the EFFECTIVE block into concrete preview geometry. This function
 * has no access to draft state by construction — its input type carries only
 * backend-resolved values.
 */
export function projectEffectivePreview(source: EffectivePreviewSource): PreviewProjection {
  // Backend authority: the resolved line is consumed verbatim — no offset
  // math happens here, so a stale draft can never leak into the projection.
  const linePercent = source.resolvedLinePercent
  const layers = source.layers?.filter((layer) => layer.enabled) ?? []
  // Worker wire precedence: non-empty layers are authoritative; the v1 mask
  // is ignored to prevent double-burn.
  const overlays = layers.length > 0
    ? projectLayers(layers, linePercent)
    : source.mask
      ? projectMask(source.mask, linePercent)
      : []

  // Worker alignment: BOTTOM anchors via the bottom edge (Alignment 2),
  // TOP/CENTER anchor their top edge on the line (Alignment 8). Styled jobs
  // use bottom-row alignment exclusively and are offset-inert (F-07).
  const lockedBottom = source.ownedByStyle || source.subtitlePosition === 'BOTTOM'

  return {
    linePercent,
    text: {
      lockedBottom,
      bottomPercent: lockedBottom ? 100 - linePercent : null,
      topPercent: lockedBottom ? null : linePercent,
      fontSizeCqh: ((source.fontSize ?? DEFAULT_PREVIEW_FONT_SIZE) / PLAY_RES_Y) * 100,
      fontWeight: source.bold ? 700 : 400,
    },
    overlays,
  }
}
