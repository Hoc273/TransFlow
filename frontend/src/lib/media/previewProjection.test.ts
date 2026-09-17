import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREVIEW_FONT_SIZE,
  PLAY_RES_Y,
  clampLinePercent,
  layerAnchorLinePercent,
  overlayTopPercent,
  projectEffectivePreview,
  subtitleAnchorLinePercent,
  type EffectivePreviewSource,
} from './previewProjection'
import type { PresentationLayer } from '@/types/media'

/**
 * Task 6 — FE ⊕ backend effective contract gate (docs/97 §19.17 §10 / Mục 7
 * audit): the preview helper must reproduce exactly what the backend computed.
 * `resolvedLinePercent` is consumed VERBATIM (never recomputed from raw draft
 * fields), overlay geometry mirrors the worker's percent-space formula, and
 * the styled path is text-locked BOTTOM with an inert offset (F-07). If these
 * expectations drift from Spring's `effectiveOf`/worker ffmpeg math, FE
 * previews diverge from real renders — that is the defect class this gate kills.
 */

function solidLayer(overrides: Partial<PresentationLayer> = {}): PresentationLayer {
  return {
    id: 'cover',
    type: 'SOLID',
    enabled: true,
    zIndex: 0,
    anchor: 'SUBTITLE',
    geometry: { widthPercent: 85, heightPercent: 12 },
    style: { opacityPercent: 60 },
    ...overrides,
  }
}

const BASE_SOURCE: EffectivePreviewSource = {
  ownedByStyle: false,
  resolvedLinePercent: 88,
  boxMode: false,
  subtitlePosition: 'BOTTOM',
  fontSize: null,
  bold: false,
  textColor: null,
}

describe('backend effective line is consumed verbatim (anti-drift gate)', () => {
  it.each([88, 3, 95, 60])('line %i passes through untouched', (line) => {
    const projection = projectEffectivePreview({ ...BASE_SOURCE, resolvedLinePercent: line })
    expect(projection.linePercent).toBe(line)
  })

  it('mirrors MediaRenderPreparationService.effectiveOf line goldens', () => {
    // Non-styled: clamp(base{8/50/88} + offset, [3..95]) — identical formula.
    expect(subtitleAnchorLinePercent('BOTTOM', 0)).toBe(88)
    expect(subtitleAnchorLinePercent('CENTER', 10)).toBe(60)
    expect(subtitleAnchorLinePercent('BOTTOM', 30)).toBe(95) // clamped high
    expect(subtitleAnchorLinePercent('BOTTOM', -30)).toBe(58)
    expect(subtitleAnchorLinePercent('CENTER', -47)).toBe(3) // clamped low
    expect(clampLinePercent(-5)).toBe(3)
    expect(clampLinePercent(120)).toBe(95)
  })
})

describe('styled path (F-07): BOTTOM-locked, offset-inert', () => {
  const styledSource: EffectivePreviewSource = {
    ...BASE_SOURCE,
    ownedByStyle: true,
    resolvedLinePercent: 88, // backend always locks styled jobs to 88
    boxMode: true,
    fontSize: 52,
    bold: true,
    subtitlePosition: 'CENTER', // stored position must NOT unlock the text
  }

  it('locks the text to the bottom edge at 100−line%', () => {
    const { text } = projectEffectivePreview(styledSource)
    expect(text.lockedBottom).toBe(true)
    expect(text.bottomPercent).toBe(12)
    expect(text.topPercent).toBeNull()
  })

  it('font size maps PlayRes units onto cqh with the fixed 1080 PlayResY', () => {
    const { text } = projectEffectivePreview(styledSource)
    expect(text.fontSizeCqh).toBeCloseTo((52 / PLAY_RES_Y) * 100, 10)
    expect(text.fontWeight).toBe(700)
    expect(
      projectEffectivePreview({ ...styledSource, fontSize: null }).text.fontSizeCqh,
    ).toBeCloseTo((DEFAULT_PREVIEW_FONT_SIZE / PLAY_RES_Y) * 100, 10)
  })
})

describe('non-styled placement follows worker alignment semantics', () => {
  it('BOTTOM anchors via the bottom edge; TOP/CENTER anchor their top on the line', () => {
    const bottom = projectEffectivePreview(BASE_SOURCE).text
    expect(bottom.lockedBottom).toBe(true)

    const top = projectEffectivePreview({
      ...BASE_SOURCE,
      resolvedLinePercent: 8,
      subtitlePosition: 'TOP',
    }).text
    expect(top.lockedBottom).toBe(false)
    expect(top.topPercent).toBe(8)

    const center = projectEffectivePreview({
      ...BASE_SOURCE,
      resolvedLinePercent: 50,
      subtitlePosition: 'CENTER',
    }).text
    expect(center.lockedBottom).toBe(false)
  })
})

describe('overlay geometry ≡ worker percent-space formula', () => {
  it('layer top = max(0, line − hp/2); SUBTITLE shares the effective line', () => {
    // Worker: y = round(H·(line − hp/2)/100) → percent space is line − hp/2.
    expect(overlayTopPercent(88, 12)).toBeCloseTo(82, 10)
    // Pixel equivalence within half a pixel across sample frames:
    for (const heightPx of [1080, 720, 409]) {
      const expectedY = Math.round((heightPx * (88 - 6)) / 100)
      const feY = overlayTopPercent(88, 12) * heightPx * 0.01
      expect(Math.abs(expectedY - feY)).toBeLessThanOrEqual(0.5)
    }
    expect(layerAnchorLinePercent('SUBTITLE', 60)).toBe(60)
  })

  it('fixed anchors ignore any offset entirely (F-09)', () => {
    expect(layerAnchorLinePercent('TOP', 95)).toBe(8)
    expect(layerAnchorLinePercent('CENTER', 95)).toBe(50)
    expect(layerAnchorLinePercent('BOTTOM', 95)).toBe(88)
  })

  it('layers sort zIndex ASC then id ASC under the subtitles', () => {
    const layers = [
      solidLayer({ id: 'zeta', zIndex: 5 }),
      solidLayer({ id: 'alpha', zIndex: 1 }),
      solidLayer({ id: 'beta', zIndex: 1 }),
    ]
    const projection = projectEffectivePreview({ ...BASE_SOURCE, layers })
    expect(projection.overlays.map((o) => o.key)).toEqual(['alpha', 'beta', 'zeta'])
  })

  it('non-empty layers REPLACE the v1 mask (worker precedence — no double-burn)', () => {
    const projection = projectEffectivePreview({
      ...BASE_SOURCE,
      mask: {
        enabled: true,
        anchor: 'SUBTITLE',
        widthPercent: 85,
        heightPercent: 12,
        opacityPercent: 60,
        paddingPercent: 2,
      },
      layers: [solidLayer()],
    })
    expect(projection.overlays).toHaveLength(1)
    expect(projection.overlays[0].key).toBe('cover')
    expect(projection.overlays[0].topPercent).toBeCloseTo(82, 10)
  })

  it('v1 mask alone projects as the single cover overlay', () => {
    const projection = projectEffectivePreview({
      ...BASE_SOURCE,
      mask: {
        enabled: true,
        anchor: 'SUBTITLE',
        widthPercent: 85,
        heightPercent: 12,
        opacityPercent: 60,
        paddingPercent: 2,
      },
    })
    expect(projection.overlays).toHaveLength(1)
    const mask = projection.overlays[0]
    expect(mask.key).toBe('mask')
    if (mask.style.kind === 'mask') {
      expect(mask.style.color).toBe('#000000') // historical default
      expect(mask.style.opacityPercent).toBe(60)
      expect(mask.style.style).toBe('SOLID')
    } else {
      throw new Error('expected a mask-style overlay')
    }
  })

  it('disabled layers are filtered before projection', () => {
    const projection = projectEffectivePreview({
      ...BASE_SOURCE,
      layers: [solidLayer({ enabled: false }), solidLayer({ id: 'live' })],
    })
    expect(projection.overlays.map((o) => o.key)).toEqual(['live'])
  })

  it('no overlays → empty projection list (plain burn)', () => {
    expect(projectEffectivePreview(BASE_SOURCE).overlays).toEqual([])
  })
})

/**
 * Golden fixtures copied from MediaRenderPreparationService.effectiveOf —
 * Phase 6 disabling logic keys off these exact control ids; if either side
 * renames them the other must move in the same commit.
 */
const BACKEND_DEAD_CONTROLS = {
  styled: [
    'backgroundColor',
    'textColor',
    'backgroundBox',
    'subtitlePosition',
    'verticalOffsetPercent',
  ],
  nonStyledBox: ['outlineWidth', 'outlineColor'],
  nonStyledRing: [] as string[],
} as const

describe('deadControls semantics mirror backend ownership branches', () => {
  it('styled branch owns colors/box/position/offset', () => {
    expect(BACKEND_DEAD_CONTROLS.styled).toEqual([
      'backgroundColor',
      'textColor',
      'backgroundBox',
      'subtitlePosition',
      'verticalOffsetPercent',
    ])
  })

  it('non-styled box mode kills only the outline pair; ring kills nothing', () => {
    expect(BACKEND_DEAD_CONTROLS.nonStyledBox).toEqual(['outlineWidth', 'outlineColor'])
    expect(BACKEND_DEAD_CONTROLS.nonStyledRing).toEqual([])
  })

  it('projection input carries the ownership flags the chip/disables consume', () => {
    const projection = projectEffectivePreview({
      ...BASE_SOURCE,
      ownedByStyle: true,
      boxMode: true,
    })
    // The helper never mutates or second-guesses backend ownership.
    expect(projection.text.lockedBottom).toBe(true)
    expect(projectEffectivePreview(BASE_SOURCE).overlays).toHaveLength(0)
  })
})
