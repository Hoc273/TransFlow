import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NarrativePlanViewer } from './NarrativePlanViewer'
import type { NarrativePlan } from '@/types/media'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.n == null ? key : `${key} ${String(options.n)}`,
  }),
}))

const plan: NarrativePlan = {
  title: 'Product launch recap',
  target_duration_ms: 60_000,
  global_reasoning_note: 'Keep the source-grounded product story.',
  confidence: 0.92,
  warnings: [],
  sections: [
    {
      seq: 1,
      heading: 'Opening',
      beat_type: 'HOOK',
      script_source_lang: 'The launch opens with the customer problem.',
      source_refs: [
        { start_ms: 10_000, end_ms: 25_000 },
        { start_ms: 30_000, end_ms: 40_000 },
      ],
      notes: null,
    },
  ],
}

describe('NarrativePlanViewer', () => {
  it('renders section, beat, script, source refs, timeline, and duration', () => {
    const html = renderToStaticMarkup(<NarrativePlanViewer plan={plan} />)

    expect(html).toContain('Product launch recap')
    expect(html).toContain('Opening')
    expect(html).toContain('narrative.beat')
    expect(html).toContain('HOOK')
    expect(html).toContain('The launch opens with the customer problem.')
    expect(html).toContain('00:10')
    expect(html).toContain('00:40')
    expect(html).toContain('00:25')
    expect(html).toContain('narrative.timeline')
    expect(html).toContain('narrative.duration')
    expect(html).toContain('data-testid="narrative-section-timeline"')
  })

  it('shows denormalized engine cut_ranges without treating them as narrative SoT', () => {
    const html = renderToStaticMarkup(
      <NarrativePlanViewer
        plan={plan}
        cutRanges={[
          { startMs: 10_000, endMs: 25_000 },
          { startMs: 30_000, endMs: 40_000 },
        ]}
        totalDurationMs={60_000}
      />,
    )

    expect(html).toContain('data-testid="narrative-engine-cuts"')
    expect(html).toContain('narrative.engineCuts')
    expect(html).toContain('00:10')
    expect(html).toContain('00:40')
  })

  it('renders rich hover tooltip with AI script and matched original dialogues', () => {
    const html = renderToStaticMarkup(
      <NarrativePlanViewer
        plan={plan}
        sourceSegments={[
          { startMs: 12_000, endMs: 20_000, sourceText: 'Original dialogue from the interview.' },
          { startMs: 50_000, endMs: 55_000, sourceText: 'Unrelated outside segment.' },
        ]}
      />,
    )

    expect(html).toContain('data-testid="narrative-tooltip-1"')
    expect(html).toContain('narrative.tooltipSummaryScript')
    expect(html).toContain('The launch opens with the customer problem.')
    expect(html).toContain('narrative.tooltipOriginalDialogue')
    expect(html).toContain('Original dialogue from the interview.')
    expect(html).not.toContain('Unrelated outside segment.')
  })

  it('renders fallback when no original dialogue matches the section span', () => {
    const html = renderToStaticMarkup(
      <NarrativePlanViewer
        plan={plan}
        sourceSegments={[
          { startMs: 50_000, endMs: 55_000, sourceText: 'Outside range segment.' },
        ]}
      />,
    )

    expect(html).toContain('data-testid="narrative-tooltip-1"')
    expect(html).toContain('narrative.tooltipNoDialogue')
  })
})
