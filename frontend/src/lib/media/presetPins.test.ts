import { describe, expect, it } from 'vitest'
import type { WorkflowPreset } from '@/types/media'
import { foldSearchText, matchesPresetQuery, visiblePresets } from './presetPins'

const preset = (id: string, name: string, description: string | null = null): WorkflowPreset => ({
  id,
  scope: 'WORKSPACE',
  workspaceId: 'ws',
  projectId: null,
  name,
  description,
  config: null,
  schemaVersion: 1,
  active: true,
  isDefault: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

describe('presetPins', () => {
  it('folds Vietnamese diacritics and case', () => {
    expect(foldSearchText('  Phụ Đề Điện Ảnh ')).toBe('phu de dien anh')
  })

  it('matches name or description, ignoring diacritics', () => {
    const p = preset('a', 'Cinematic Subtitles', 'Phụ đề cho phim')
    expect(matchesPresetQuery(p, 'cinematic')).toBe(true)
    expect(matchesPresetQuery(p, 'phu de')).toBe(true)
    expect(matchesPresetQuery(p, 'shorts')).toBe(false)
    expect(matchesPresetQuery(p, '   ')).toBe(true)
  })

  it('floats pinned presets to the top and keeps the rest in order', () => {
    const list = [preset('a', 'A'), preset('b', 'B'), preset('c', 'C')]
    const out = visiblePresets(list, { query: '', pins: new Set(['c']), pinnedOnly: false })
    expect(out.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('pinned-only keeps just the pinned presets', () => {
    const list = [preset('a', 'A'), preset('b', 'B')]
    const out = visiblePresets(list, { query: '', pins: new Set(['b']), pinnedOnly: true })
    expect(out.map((p) => p.id)).toEqual(['b'])
  })
})
