import { describe, expect, it } from 'vitest'
import { formatTimecode, parseTimecode } from '@/lib/timecode'

describe('subtitle timecodes', () => {
  it('formats milliseconds as m:ss.mmm (h:mm:ss.mmm past an hour)', () => {
    expect(formatTimecode(0)).toBe('0:00.000')
    expect(formatTimecode(65_250)).toBe('1:05.250')
    expect(formatTimecode(3_723_004)).toBe('1:02:03.004')
    expect(formatTimecode(null)).toBe('')
  })

  it('parses timecodes and plain seconds', () => {
    expect(parseTimecode('1:05.250')).toBe(65_250)
    expect(parseTimecode('1:02:03.004')).toBe(3_723_004)
    expect(parseTimecode('12.5')).toBe(12_500)
    expect(parseTimecode('0:05,5')).toBe(5_500)
  })

  it('rejects malformed input instead of guessing', () => {
    expect(parseTimecode('')).toBeNull()
    expect(parseTimecode('1:75')).toBeNull()
    expect(parseTimecode('1.5:00')).toBeNull()
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('-1')).toBeNull()
  })

  it('round-trips', () => {
    for (const ms of [0, 999, 59_999, 60_000, 3_599_999, 3_600_000]) {
      expect(parseTimecode(formatTimecode(ms))).toBe(ms)
    }
  })
})
