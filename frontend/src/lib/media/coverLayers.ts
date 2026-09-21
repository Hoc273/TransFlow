// @ts-nocheck
import type {
  PresentationLayer,
  PresentationLayerAnchor,
  SubtitleMaskConfig,
} from '@/types/media'

/**
 * V2 cover-layers editor helpers (docs/97 §19.17 §B exposure).
 *
 * The BA-frozen wire contract allows at most 4 overlay layers, each with a
 * semantic anchor (SUBTITLE shares the effective subtitle line; TOP/CENTER/
 * BOTTOM are fixed frame lines), centered-x geometry and an XOR style group
 * (SOLID → color+opacity, BLUR → blurRadius). Layers are authoritative for the
 * worker — a non-empty array makes the legacy v1 mask field inert — and the
 * Spring validator rejects the two together, so editors ALWAYS emit `layers`
 * and never write the v1 `mask` again. A legacy stored mask is converted into
 * the equivalent single SUBTITLE layer on hydration (render-equivalent: the
 * worker keeps the filter string byte-identical for the single-layer case).
 */

export const MAX_COVER_LAYERS = 4

export const COVER_WIDTH_MIN = 20
export const COVER_WIDTH_MAX = 100
export const COVER_HEIGHT_MIN = 5
export const COVER_HEIGHT_MAX = 50
export const COVER_BLUR_MIN = 2
export const COVER_BLUR_MAX = 20
export const COVER_OPACITY_MIN = 0
export const COVER_OPACITY_MAX = 100

/** Wire-anchor order used for the per-layer position selector. */
export const COVER_ANCHORS: PresentationLayerAnchor[] = [
  'SUBTITLE',
  'TOP',
  'CENTER',
  'BOTTOM',
]

/** Anchor preference for freshly added layers — the first layer anchors the
 * subtitle line (mirrors the historical v1 mask that covered the old burned-in
 * subtitle); the next layers rotate through the free fixed lines (CENTER first:
 * the common second cover is mid-frame text). */
const NEW_LAYER_ANCHOR_PREFERENCE: PresentationLayerAnchor[] = [
  'SUBTITLE',
  'CENTER',
  'TOP',
  'BOTTOM',
]

/** Wire id pattern ^[a-z0-9]+(-[a-z0-9]+)*$ — deterministic per slot. */
export function coverLayerId(existing: PresentationLayer[]): string {
  const taken = new Set(existing.map((layer) => layer.id))
  for (let n = 1; n <= MAX_COVER_LAYERS * 10; n += 1) {
    const id = `cover-${n}`
    if (!taken.has(id)) return id
  }
  return `cover-${Date.now().toString(36)}`
}

/** Default newly added layer: BLUR frosted glass on the first free anchor. */
export function defaultCoverLayer(existing: PresentationLayer[]): PresentationLayer {
  const usedAnchors = new Set(existing.map((layer) => layer.anchor))
  const anchor =
    NEW_LAYER_ANCHOR_PREFERENCE.find((candidate) => !usedAnchors.has(candidate)) ?? 'CENTER'
  return {
    id: coverLayerId(existing),
    type: 'BLUR',
    enabled: true,
    zIndex: existing.length,
    anchor,
    geometry: { widthPercent: 84, heightPercent: 8 },
    style: { blurRadius: 10 },
  }
}

/**
 * Legacy v1 mask → the equivalent single SUBTITLE layer (worker keeps the
 * filter string byte-identical for this shape). A disabled/absent mask yields
 * no layers — the caller decides the enabled flag.
 */
export function maskToLayers(mask: SubtitleMaskConfig | null | undefined): PresentationLayer[] {
  if (!mask || mask.enabled !== true) return []
  const type = mask.style === 'BLUR' ? 'BLUR' : 'SOLID'
  return [
    {
      id: 'cover-1',
      type,
      enabled: true,
      zIndex: 0,
      anchor: 'SUBTITLE',
      geometry: {
        widthPercent: mask.widthPercent,
        heightPercent: mask.heightPercent,
      },
      style:
        type === 'BLUR'
          ? { blurRadius: mask.blurRadius ?? 12 }
          : { color: mask.color ?? '#000000', opacityPercent: mask.opacityPercent },
    },
  ]
}

/** Editor draft → wire array: renumber zIndex from array order, clamp numbers,
 * force enabled=true (the validator rejects an existing-but-disabled layer). */
export function toWireLayers(layers: PresentationLayer[]): PresentationLayer[] {
  return layers.map((layer, index) => ({
    ...layer,
    enabled: true,
    zIndex: index,
    geometry: {
      widthPercent: clamp(layer.geometry.widthPercent, COVER_WIDTH_MIN, COVER_WIDTH_MAX),
      heightPercent: clamp(layer.geometry.heightPercent, COVER_HEIGHT_MIN, COVER_HEIGHT_MAX),
      ...(layer.geometry.xPercent !== null && layer.geometry.xPercent !== undefined
        ? { xPercent: clamp(Math.round(layer.geometry.xPercent), 0, 100) }
        : {}),
      ...(layer.geometry.yPercent !== null && layer.geometry.yPercent !== undefined
        ? { yPercent: clamp(Math.round(layer.geometry.yPercent), 0, 100) }
        : {}),
    },
    style:
      layer.type === 'BLUR'
        ? { blurRadius: clamp(layer.style.blurRadius, COVER_BLUR_MIN, COVER_BLUR_MAX) }
        : {
            color: layer.style.color ?? '#000000',
            opacityPercent: clamp(layer.style.opacityPercent ?? 60, COVER_OPACITY_MIN, COVER_OPACITY_MAX),
          },
  }))
}

/**
 * Stored presentation subtitle → editor state. Stored v2 layers win; a legacy
 * enabled v1 mask is converted to the equivalent single layer; anything else
 * starts disabled with one default layer ready to configure.
 */
export function hydrateCoverState(subtitle: {
  mask?: SubtitleMaskConfig | null
  layers?: PresentationLayer[] | null
} | null | undefined): { enabled: boolean; layers: PresentationLayer[] } {
  const storedLayers = subtitle?.layers
  if (Array.isArray(storedLayers) && storedLayers.length > 0) {
    return { enabled: true, layers: toWireLayers(storedLayers) }
  }
  const converted = maskToLayers(subtitle?.mask)
  if (converted.length > 0) return { enabled: true, layers: converted }
  return { enabled: false, layers: [defaultCoverLayer([])] }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
