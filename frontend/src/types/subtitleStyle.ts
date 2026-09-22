/**
 * B1.2 Subtitle Style contract (docs/93 §4.6.11).
 *
 * The backend identifies presets by stable `assetKey` only — internal asset
 * UUIDs are never on the wire and must never be reintroduced here. Wire JSON is
 * snake_case; these types mirror it verbatim so no field is silently renamed.
 */

/** Canonical 13-field style snapshot, shared by detail and current-style reads. */
export type SubtitleStyleSnapshot = {
  font_family: string
  font_size: number
  primary_color: string
  outline_color: string
  outline_width: number
  shadow: boolean
  bold: boolean
  italic: boolean
  alignment: string
  margin_v: number
  line_spacing: number
  /** Absent when the preset defines no background. */
  background?: string | null
  opacity: number
}

/** Item of `GET /media/subtitle-styles`. Optional fields are omitted, not null. */
export type SubtitleStylePreset = {
  key: string
  name: string
  language?: string | null
  thumbnail?: string | null
  preview_text?: string | null
  revision: number
}

/** `GET /media/subtitle-styles/{key}` — preset identity plus its full snapshot. */
export type SubtitleStyleDetail = SubtitleStyleSnapshot & {
  key: string
  name: string
  revision: number
}

/**
 * `GET`/`POST /media/jobs/{jobId}/subtitle-style`.
 *
 * Deliberately snapshot-only: the response carries no key/name/revision, so the
 * assigned preset is identified by matching this snapshot against the preset
 * list rather than by reading an identifier off the response.
 */
export type CurrentSubtitleStyle = SubtitleStyleSnapshot

/** B1.2 standardized error codes surfaced on `ApiError.code`. */
export const SUBTITLE_STYLE_ERROR_CODES = [
  'INVALID_STYLE_KEY',
  'STYLE_NOT_FOUND',
  'STYLE_NOT_ACTIVE',
] as const

export type SubtitleStyleErrorCode = (typeof SUBTITLE_STYLE_ERROR_CODES)[number]

export function isSubtitleStyleErrorCode(code: string): code is SubtitleStyleErrorCode {
  return (SUBTITLE_STYLE_ERROR_CODES as readonly string[]).includes(code)
}
