import { describe, expect, it } from 'vitest'
import {
  countIssuesByBand,
  qaBadgeSummary,
  severityBand,
  sortIssuesForDisplay,
} from './MediaQaPanel'
import type { QaIssue } from '@/types/qa'

function issue(partial: Partial<QaIssue>): QaIssue {
  return {
    id: 'i1',
    type: 'grammar',
    severity: 'LOW',
    message: 'msg',
    sourceSpan: null,
    targetSpan: null,
    suggestion: null,
    resolved: false,
    ...partial,
  }
}

describe('MediaQaPanel severity bands', () => {
  it('maps CRITICAL and HIGH to HIGH band', () => {
    expect(severityBand('CRITICAL')).toBe('HIGH')
    expect(severityBand('HIGH')).toBe('HIGH')
    expect(severityBand('critical')).toBe('HIGH')
  })

  it('maps MEDIUM and LOW distinctly', () => {
    expect(severityBand('MEDIUM')).toBe('MEDIUM')
    expect(severityBand('LOW')).toBe('LOW')
    expect(severityBand('unknown')).toBe('LOW')
  })

  it('counts open issues by band and ignores resolved', () => {
    const counts = countIssuesByBand([
      issue({ id: '1', severity: 'CRITICAL' }),
      issue({ id: '2', severity: 'HIGH' }),
      issue({ id: '3', severity: 'MEDIUM' }),
      issue({ id: '4', severity: 'LOW' }),
      issue({ id: '5', severity: 'HIGH', resolved: true }),
    ])
    expect(counts).toEqual({ high: 2, medium: 1, low: 1 })
  })
})

describe('MediaQaPanel display order', () => {
  it('sorts severity high → low and pushes resolved issues to the end', () => {
    const sorted = sortIssuesForDisplay([
      issue({ id: 'low-open', severity: 'LOW' }),
      issue({ id: 'med-open', severity: 'MEDIUM' }),
      issue({ id: 'crit-open', severity: 'CRITICAL' }),
      issue({ id: 'crit-resolved', severity: 'CRITICAL', resolved: true }),
      issue({ id: 'high-open', severity: 'HIGH' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual([
      'crit-open',
      'high-open',
      'med-open',
      'low-open',
      'crit-resolved',
    ])
  })

  it('keeps original order within the same severity (stable sort)', () => {
    const sorted = sortIssuesForDisplay([
      issue({ id: 'a', severity: 'HIGH' }),
      issue({ id: 'b', severity: 'HIGH' }),
      issue({ id: 'c', severity: 'HIGH' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('MediaQaPanel trigger badge summary', () => {
  it('returns per-band open counts (red=CRITICAL+HIGH, amber=MEDIUM, green=LOW)', () => {
    expect(
      qaBadgeSummary([issue({ id: '1', severity: 'HIGH' }), issue({ id: '2', severity: 'LOW' })]),
    ).toEqual({ high: 1, medium: 0, low: 1 })
    expect(
      qaBadgeSummary([issue({ id: '1', severity: 'MEDIUM' }), issue({ id: '2', severity: 'LOW' })]),
    ).toEqual({ high: 0, medium: 1, low: 1 })
    expect(qaBadgeSummary([issue({ id: '1', severity: 'LOW' })])).toEqual({
      high: 0,
      medium: 0,
      low: 1,
    })
    expect(qaBadgeSummary([issue({ id: '1', severity: 'HIGH', resolved: true })])).toEqual({
      high: 0,
      medium: 0,
      low: 0,
    })
  })
})
