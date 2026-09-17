import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RefineNarrativeModal } from './RefineNarrativeModal'
import type { MediaSummaryProposal } from '@/types/media'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return String(options.defaultValue)
      if (options?.s != null) return `${key} ${String(options.s)}`
      if (options?.n != null) return `${key} ${String(options.n)}`
      return key
    },
  }),
}))

const mockProposal: MediaSummaryProposal = {
  id: 'prop-1',
  proposal_index: 1,
  generated_by: 'AI',
  generation_round: 1,
  archived_at: null,
  cut_ranges: [{ start_ms: 0, end_ms: 30_000 }],
  reasoning_note: 'AI test note',
  total_duration_ms: 30_000,
  confidence: 0.95,
  warnings: [],
  planKind: 'NARRATIVE_PLAN',
  planBody: {
    title: 'Test Narrative',
    target_duration_ms: 30_000,
    global_reasoning_note: null,
    confidence: 0.95,
    warnings: [],
    sections: [
      {
        seq: 1,
        heading: 'Intro Hook',
        beat_type: 'HOOK',
        script_source_lang: 'First line of script',
        source_refs: [{ start_ms: 0, end_ms: 15_000 }],
        notes: null,
      },
      {
        seq: 2,
        heading: 'Action Scene',
        beat_type: 'BODY',
        script_source_lang: 'Second line of script',
        source_refs: [{ start_ms: 15_000, end_ms: 30_000 }],
        notes: null,
      },
    ],
  },
}

describe('RefineNarrativeModal', () => {
  it('renders nothing when open is false', () => {
    const html = renderToStaticMarkup(
      <RefineNarrativeModal
        open={false}
        onClose={vi.fn()}
        proposal={mockProposal}
        onRefine={vi.fn()}
        isPending={false}
      />,
    )
    expect(html).toBe('')
  })

  it('renders section coverage timeline, tone/focus controls, quick tags, and feedback input when open', () => {
    const html = renderToStaticMarkup(
      <RefineNarrativeModal
        open={true}
        onClose={vi.fn()}
        proposal={mockProposal}
        totalDurationMs={30_000}
        requestedDurationSeconds={30}
        onRefine={vi.fn()}
        isPending={false}
      />,
    )

    expect(html).toContain('data-testid="narrative-refine-form"')
    expect(html).toContain('data-testid="refine-modal-coverage-timeline"')
    expect(html).toContain('Intro Hook')
    expect(html).toContain('Action Scene')
    expect(html).toContain('#1')
    expect(html).toContain('#2')
    expect(html).toContain('data-testid="narrative-refine-feedback"')
    expect(html).toContain('data-testid="narrative-refine-submit"')
    expect(html).toContain('refine.targetDuration')
    expect(html).toContain('refine.tone')
    expect(html).toContain('refine.focus')
    expect(html).toContain('refine.quickTags')
    expect(html).toContain('Ưu tiên phân cảnh hành động kịch tính')
  })

  it('renders disconnected source refs as separate bars and sums actual coverage', () => {
    const basePlan = mockProposal.planBody!
    const proposalWithGap: MediaSummaryProposal = {
      ...mockProposal,
      total_duration_ms: 60_000,
      planBody: {
        title: basePlan.title,
        target_duration_ms: 30_000,
        global_reasoning_note: basePlan.global_reasoning_note,
        confidence: basePlan.confidence,
        warnings: basePlan.warnings,
        sections: [
          {
            ...basePlan.sections[0],
            source_refs: [
              { start_ms: 0, end_ms: 10_000 },
              { start_ms: 50_000, end_ms: 60_000 },
            ],
          },
        ],
      },
    }

    const html = renderToStaticMarkup(
      <RefineNarrativeModal
        open={true}
        onClose={vi.fn()}
        proposal={proposalWithGap}
        totalDurationMs={60_000}
        requestedDurationSeconds={30}
        onRefine={vi.fn()}
        isPending={false}
      />,
    )

    expect(html).toContain('Actual 00:20 / target 00:30')
    expect(html).toContain('data-testid="refine-modal-coverage-ref-1-0"')
    expect(html).toContain('data-testid="refine-modal-coverage-ref-1-1"')
    expect(html).toContain('>00:20</span>')
    expect(html).not.toContain('>00:50</span>')
  })
})
