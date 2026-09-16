import type {
  RenderPresentationConfig,
  SubtitlePresentation,
  SubtitleTypographyOverride,
  TriStateDirective,
} from '@/types/media'

/**
 * F-01 tri-state payload builders for the render-config PUT (docs/97 §19.17).
 *
 * Wire semantics (UpdateRenderConfigRequest — the backend is the authority):
 * - top-level `backgroundColor` / `textColor` are raw tri-state nodes:
 *   key absent = KEEP stored · explicit null = CLEAR · string = VALIDATE+REPLACE.
 * - `presentation` is absent-preserves / present-replaces-whole, so the
 *   typography override subset (fontSize/bold/outlineWidth/outlineColor) is
 *   expressed per-field by REBUILDING the full typography object from the
 *   stored one: keep resends the stored value, clear sends an explicit null,
 *   replace sends the new value.
 */

/** Maps a color directive onto its wire representation (undefined drops the key). */
export function colorDirective(tri: TriStateDirective<string>): string | null | undefined {
  switch (tri.op) {
    case 'keep':
      return undefined
    case 'clear':
      return null
    case 'replace':
      return tri.value
  }
}

export type TypographyPatchInput = {
  /** Current stored typography (from GET render-config); null when none. */
  storedTypography?: SubtitleTypographyOverride | null
  fontSize?: TriStateDirective<number>
  bold?: TriStateDirective<boolean>
  outlineWidth?: TriStateDirective<number>
  outlineColor?: TriStateDirective<string>
}

function resolvePatchField<T>(
  tri: TriStateDirective<T> | undefined,
  stored: T | null | undefined,
): T | null | undefined {
  if (!tri || tri.op === 'keep') return stored ?? undefined
  if (tri.op === 'clear') return null
  return tri.value
}

/**
 * Builds the full-replacement `typography` node for the PUT body.
 *
 * Returns `undefined` when nothing changes (no directives and no stored
 * typography) so the envelope can stay absent entirely — an absent
 * presentation preserves what is stored server-side.
 */
export function typographyPatch(input: TypographyPatchInput): SubtitleTypographyOverride | undefined {
  const fontSize = resolvePatchField(input.fontSize, input.storedTypography?.fontSize)
  const bold = resolvePatchField(input.bold, input.storedTypography?.bold)
  const outlineWidth = resolvePatchField(
    input.outlineWidth,
    input.storedTypography?.outlineWidth,
  )
  const outlineColor = resolvePatchField(
    input.outlineColor,
    input.storedTypography?.outlineColor,
  )

  if (
    fontSize === undefined &&
    bold === undefined &&
    outlineWidth === undefined &&
    outlineColor === undefined
  ) {
    return input.storedTypography ?? undefined
  }

  const patch: SubtitleTypographyOverride = {}
  if (fontSize !== undefined) patch.fontSize = fontSize
  if (bold !== undefined) patch.bold = bold
  if (outlineWidth !== undefined) patch.outlineWidth = outlineWidth
  if (outlineColor !== undefined) patch.outlineColor = outlineColor
  return patch
}

/**
 * Embeds a typography patch into the presentation envelope for the PUT body.
 *
 * - No patch and no stored envelope → `undefined` (omit `presentation`; the
 *   backend preserves whatever is stored).
 * - Patch but no stored subtitle subtree → a minimal v2 subtitle node is
 *   created around it (schemaVersion/displayMode defaults mirror the
 *   canonicalizer's expectations).
 */
export function applyTypographyToEnvelope(
  storedEnvelope: RenderPresentationConfig | null | undefined,
  typography: SubtitleTypographyOverride | undefined,
): RenderPresentationConfig | undefined {
  if (!typography) return undefined
  const storedSubtitle: SubtitlePresentation =
    storedEnvelope?.subtitle ?? { schemaVersion: 2, displayMode: 'SENTENCE' }
  return {
    ...(storedEnvelope ?? {}),
    subtitle: {
      ...storedSubtitle,
      typography,
    },
  }
}
