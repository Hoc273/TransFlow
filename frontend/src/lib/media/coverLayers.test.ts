import { describe, expect, it } from 'vitest'
import {
  defaultCoverLayer,
  hydrateCoverState,
  maskToLayers,
  MAX_COVER_LAYERS,
  toWireLayers,
} from './coverLayers'
import type { PresentationLayer, SubtitleMaskConfig } from '@/types/media'

const legacyBlurMask: SubtitleMaskConfig = {
  enabled: true,
  anchor: 'SUBTITLE',
  widthPercent: 80,
  heightPercent: 10,
  opacityPercent: 70,
  paddingPercent: 3,
  style: 'BLUR',
  blurRadius: 9,
  color: '#336699',
}

const legacySolidMask: SubtitleMaskConfig = {
  enabled: true,
  anchor: 'SUBTITLE',
  widthPercent: 85,
  heightPercent: 12,
  opacityPercent: 60,
  paddingPercent: 2,
  style: 'SOLID',
  blurRadius: null,
  color: '#000000',
}

describe('maskToLayers — legacy v1 mask → equivalent v2 layer', () => {
  it('converts a BLUR mask into a single SUBTITLE layer carrying only blurRadius', () => {
    const layers = maskToLayers(legacyBlurMask)
    expect(layers).toHaveLength(1)
    const layer = layers[0]
    expect(layer.id).toBe('cover-1')
    expect(layer.type).toBe('BLUR')
    expect(layer.enabled).toBe(true)
    expect(layer.zIndex).toBe(0)
    expect(layer.anchor).toBe('SUBTITLE')
    expect(layer.geometry).toEqual({ widthPercent: 80, heightPercent: 10 })
    // Style XOR: BLUR never carries the mask color.
    expect(layer.style).toEqual({ blurRadius: 9 })
  })

  it('converts a SOLID mask into a SOLID layer with color + opacity', () => {
    const layer = maskToLayers(legacySolidMask)[0]
    expect(layer.type).toBe('SOLID')
    expect(layer.style).toEqual({ color: '#000000', opacityPercent: 60 })
  })

  it('yields no layers for a disabled or absent mask', () => {
    expect(maskToLayers(null)).toEqual([])
    expect(maskToLayers({ ...legacySolidMask, enabled: false })).toEqual([])
  })
})

describe('toWireLayers — editor draft → wire array', () => {
  it('renumbers zIndex from array order and forces enabled=true', () => {
    const layers: PresentationLayer[] = [
      { ...maskToLayers(legacySolidMask)[0] },
      { ...defaultCoverLayer([maskToLayers(legacySolidMask)[0]]) },
    ]
    const wire = toWireLayers(layers)
    expect(wire.map((l) => l.zIndex)).toEqual([0, 1])
    expect(wire.every((l) => l.enabled === true)).toBe(true)
  })

  it('clamps geometry and style numbers into the validator ranges', () => {
    const base = maskToLayers(legacyBlurMask)[0]
    const wire = toWireLayers([
      {
        ...base,
        geometry: { widthPercent: 500, heightPercent: -3 },
        style: { blurRadius: 99 },
      },
    ])
    expect(wire[0].geometry).toEqual({ widthPercent: 100, heightPercent: 5 })
    expect(wire[0].style).toEqual({ blurRadius: 20 })
  })
})

describe('defaultCoverLayer — anchor progression for added layers', () => {
  it('first layer anchors the subtitle line (mirrors the v1 mask)', () => {
    const layer = defaultCoverLayer([])
    expect(layer.anchor).toBe('SUBTITLE')
    expect(layer.type).toBe('BLUR')
    expect(layer.enabled).toBe(true)
  })

  it('subsequent layers take the first free fixed line (CENTER → TOP → BOTTOM)', () => {
    const first = defaultCoverLayer([])
    const second = defaultCoverLayer([first])
    const third = defaultCoverLayer([first, second])
    const fourth = defaultCoverLayer([first, second, third])
    expect([second.anchor, third.anchor, fourth.anchor]).toEqual(['CENTER', 'TOP', 'BOTTOM'])
    // Unique deterministic ids within the wire pattern.
    const ids = new Set([first.id, second.id, third.id, fourth.id])
    expect(ids.size).toBe(4)
  })

  it('never proposes more than the contract cap', () => {
    const all: PresentationLayer[] = []
    for (let i = 0; i < MAX_COVER_LAYERS; i += 1) all.push(defaultCoverLayer(all))
    expect(all).toHaveLength(MAX_COVER_LAYERS)
  })
})

describe('hydrateCoverState — stored subtitle → editor state', () => {
  it('prefers stored v2 layers and normalizes them', () => {
    const stored: PresentationLayer[] = [
      {
        id: 'cover-1',
        type: 'SOLID',
        enabled: true,
        zIndex: 0,
        anchor: 'BOTTOM',
        geometry: { widthPercent: 50, heightPercent: 6 },
        style: { color: '#112233', opacityPercent: 100 },
      },
    ]
    const state = hydrateCoverState({ mask: legacyBlurMask, layers: stored })
    expect(state.enabled).toBe(true)
    expect(state.layers).toEqual(stored)
  })

  it('converts a legacy enabled mask into the equivalent single layer', () => {
    const state = hydrateCoverState({ mask: legacyBlurMask, layers: null })
    expect(state.enabled).toBe(true)
    expect(state.layers).toEqual(maskToLayers(legacyBlurMask))
  })

  it('starts disabled with one default layer when nothing is stored', () => {
    const state = hydrateCoverState(null)
    expect(state.enabled).toBe(false)
    expect(state.layers).toHaveLength(1)
    expect(state.layers[0].anchor).toBe('SUBTITLE')
  })
})
