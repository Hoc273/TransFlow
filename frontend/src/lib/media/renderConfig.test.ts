import { describe, expect, it } from 'vitest'
import {
  applyTypographyToEnvelope,
  colorDirective,
  typographyPatch,
  type TypographyPatchInput,
} from './renderConfig'
import { deriveStyleAssignment } from '@/hooks/useSubtitleStyle'

/**
 * F-01 tri-state payload builders (docs/97 §19.17) — the 3 wire states
 * (absent=KEEP · explicit null=CLEAR · value=REPLACE) must survive the helper
 * layer for all four overridable fields; anything else would drift from the
 * backend's UpdateRenderConfigRequest semantics.
 */

describe('colorDirective (backgroundColor / textColor)', () => {
  it('keep drops the key (undefined is omitted by JSON.stringify)', () => {
    expect(colorDirective({ op: 'keep' })).toBeUndefined()
  })

  it('clear sends an explicit null', () => {
    expect(colorDirective({ op: 'clear' })).toBeNull()
  })

  it('replace sends the validated value verbatim', () => {
    expect(colorDirective({ op: 'replace', value: '#11223344' })).toBe('#11223344')
  })
})

const STORED_TYPOGRAPHY = {
  fontSize: 52,
  bold: true,
  outlineWidth: 3,
  outlineColor: '#123456',
}

describe('typographyPatch — tri-state matrix × 4 fields', () => {
  function patchWith(directive: TypographyPatchInput): TypographyPatchInput['storedTypography'] & object {
    return typographyPatch({ storedTypography: STORED_TYPOGRAPHY, ...directive })!
  }

  it('fontSize follows keep / clear / replace', () => {
    expect(patchWith({}).fontSize).toBe(52)
    expect(patchWith({ fontSize: { op: 'clear' } }).fontSize).toBeNull()
    expect(patchWith({ fontSize: { op: 'replace', value: 44 } }).fontSize).toBe(44)
  })

  it('bold follows keep / clear / replace', () => {
    expect(patchWith({}).bold).toBe(true)
    expect(patchWith({ bold: { op: 'clear' } }).bold).toBeNull()
    expect(patchWith({ bold: { op: 'replace', value: false } }).bold).toBe(false)
  })

  it('outlineWidth follows keep / clear / replace', () => {
    expect(patchWith({}).outlineWidth).toBe(3)
    expect(patchWith({ outlineWidth: { op: 'clear' } }).outlineWidth).toBeNull()
    expect(patchWith({ outlineWidth: { op: 'replace', value: 0 } }).outlineWidth).toBe(0)
  })

  it('outlineColor follows keep / clear / replace', () => {
    expect(patchWith({}).outlineColor).toBe('#123456')
    expect(patchWith({ outlineColor: { op: 'clear' } }).outlineColor).toBeNull()
    expect(patchWith({ outlineColor: { op: 'replace', value: '#ABCDEF' } }).outlineColor).toBe('#ABCDEF')
  })

  it('no directives resends every stored field (full-replacement preservation)', () => {
    expect(typographyPatch({ storedTypography: STORED_TYPOGRAPHY })).toEqual({
      fontSize: 52,
      bold: true,
      outlineWidth: 3,
      outlineColor: '#123456',
    })
  })

  it('a lone explicit null still emits a typography node (the CLEAR mechanism)', () => {
    expect(
      typographyPatch({ storedTypography: null, outlineWidth: { op: 'clear' } }),
    ).toEqual({ outlineWidth: null })
  })

  it('no directives + no stored typography → omit the node entirely', () => {
    expect(typographyPatch({})).toBeUndefined()
    expect(typographyPatch({ storedTypography: null })).toBeUndefined()
  })
})

describe('applyTypographyToEnvelope', () => {
  it('no patch → absent presentation key regardless of stored envelope', () => {
    const stored = { subtitle: { schemaVersion: 2 as const, displayMode: 'SENTENCE' as const } }
    expect(applyTypographyToEnvelope(stored, undefined)).toBeUndefined()
    expect(applyTypographyToEnvelope(null, undefined)).toBeUndefined()
  })

  it('patch without stored subtree creates a minimal v2 subtitle node', () => {
    const envelope = applyTypographyToEnvelope(null, { outlineWidth: 2 })
    expect(envelope?.subtitle).toMatchObject({
      schemaVersion: 2,
      displayMode: 'SENTENCE',
      typography: { outlineWidth: 2 },
    })
  })

  it('patch keeps the other stored subtitle fields intact', () => {
    const envelope = applyTypographyToEnvelope(
      {
        subtitle: {
          schemaVersion: 2,
          displayMode: 'CHARACTERS',
          maxCharactersPerCue: 42,
          mask: {
            enabled: true,
            anchor: 'SUBTITLE',
            widthPercent: 85,
            heightPercent: 12,
            opacityPercent: 60,
            paddingPercent: 2,
          },
        },
        audio: { schemaVersion: 1 },
      },
      { fontSize: 40 },
    )
    expect(envelope?.subtitle?.displayMode).toBe('CHARACTERS')
    expect(envelope?.subtitle?.maxCharactersPerCue).toBe(42)
    expect(envelope?.subtitle?.mask).toBeTruthy()
    expect(envelope?.audio).toEqual({ schemaVersion: 1 })
  })
})

describe('deriveStyleAssignment (Task 4 — style-assigned state)', () => {
  const snapshot = {
    font_family: 'Arial',
    font_size: 52,
    primary_color: '#FFFFFF',
    outline_color: '#000000',
    outline_width: 4,
    shadow: true,
    bold: true,
    italic: false,
    alignment: 'center',
    margin_v: 24,
    line_spacing: 0,
    background: '#000000CC',
    opacity: 100,
  }

  it('nothing assigned → styleAssigned false and no box-mode claim', () => {
    expect(deriveStyleAssignment(null)).toEqual({
      styleAssigned: false,
      snapshot: null,
      styledBoxMode: false,
    })
    expect(deriveStyleAssignment(undefined).styleAssigned).toBe(false)
  })

  it('assigned ring snapshot → styled but not box mode', () => {
    const state = deriveStyleAssignment({ ...snapshot, background: null })
    expect(state.styleAssigned).toBe(true)
    expect(state.styledBoxMode).toBe(false)
  })

  it('assigned boxed snapshot → styledBoxMode mirrors F-12/F-13 authority', () => {
    const state = deriveStyleAssignment(snapshot)
    expect(state.styleAssigned).toBe(true)
    expect(state.styledBoxMode).toBe(true)
  })
})
