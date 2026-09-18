import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProposalCard, ProposalPanel } from './ProposalPanel'
import type { MediaJob, MediaSummaryProposal } from '@/types/media'

const refineMutateAsync = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.n == null ? key : `${key} ${String(options.n)}`,
  }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaProposals: () => ({
    data: [
      {
        id: 'proposal-1',
        proposal_index: 1,
        generated_by: 'AI',
        generation_round: 1,
        archived_at: null,
        cut_ranges: [{ start_ms: 0, end_ms: 20_000 }],
        reasoning_note: null,
        total_duration_ms: 20_000,
        confidence: 0.9,
        warnings: [],
        planKind: 'NARRATIVE_PLAN',
        planBody: {
          title: 'Narrative option',
          target_duration_ms: 20_000,
          global_reasoning_note: null,
          confidence: 0.9,
          warnings: [],
          sections: [
            {
              seq: 1,
              heading: 'Hook',
              beat_type: 'HOOK',
              script_source_lang: 'Open with the strongest source quote.',
              source_refs: [{ start_ms: 0, end_ms: 20_000 }],
              notes: null,
            },
          ],
        },
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSelectProposal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateCustomProposal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRerunSummarize: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefineNarrativePlan: () => ({
    mutateAsync: refineMutateAsync,
    isPending: false,
  }),
  useMediaLinkedJob: () => ({ data: undefined, isLoading: false }),
}))

const baseProposal: MediaSummaryProposal = {
  id: 'proposal-1',
  proposal_index: 1,
  generated_by: 'AI',
  generation_round: 1,
  archived_at: null,
  cut_ranges: [],
  reasoning_note: null,
  total_duration_ms: 60_000,
  confidence: 0.9,
  warnings: [],
}

const baseJob: Pick<MediaJob, 'recipeId' | 'processingMode' | 'selectedProposalId'> = {
  recipeId: 'summary.extractive',
  processingMode: 'HYBRID',
  selectedProposalId: null,
}

describe('ProposalCard', () => {
  it('renders a NARRATIVE_PLAN through NarrativePlanViewer with engine cuts', () => {
    const proposal: MediaSummaryProposal = {
      ...baseProposal,
      planKind: 'NARRATIVE_PLAN',
      cut_ranges: [{ start_ms: 5_000, end_ms: 20_000 }],
      planBody: {
        title: 'Narrative option',
        target_duration_ms: 60_000,
        global_reasoning_note: null,
        confidence: 0.9,
        warnings: [],
        sections: [
          {
            seq: 1,
            heading: 'Hook',
            beat_type: 'HOOK',
            script_source_lang: 'Open with the strongest source quote.',
            source_refs: [{ start_ms: 5_000, end_ms: 20_000 }],
            notes: null,
          },
        ],
      },
    }

    const html = renderToStaticMarkup(
      <ProposalCard
        proposal={proposal}
        job={{ ...baseJob, recipeId: 'summary.generative' }}
        selectionState="candidate"
        selectionLocked={false}
        requestedSec={60}
        onSelect={() => undefined}
        busy={false}
        canSelect
      />,
    )

    expect(html).toContain('data-testid="narrative-plan-viewer"')
    expect(html).toContain('data-plan-kind="NARRATIVE_PLAN"')
    expect(html).toContain('Open with the strongest source quote.')
    expect(html).toContain('data-testid="narrative-engine-cuts"')
    expect(html).not.toContain('proposals.requested')
  })

  it('keeps extractive CUT_PLAN rendering with cut timeline', () => {
    const proposal: MediaSummaryProposal = {
      ...baseProposal,
      planKind: 'CUT_PLAN',
      cut_ranges: [{ start_ms: 10_000, end_ms: 40_000 }],
      reasoning_note: 'Keep the product demo.',
    }

    const html = renderToStaticMarkup(
      <ProposalCard
        proposal={proposal}
        job={baseJob}
        selectionState="selected"
        selectionLocked={false}
        requestedSec={60}
        onSelect={() => undefined}
        busy={false}
        canSelect
      />,
    )

    expect(html).not.toContain('narrative-plan-viewer')
    expect(html).toContain('data-plan-kind="CUT_PLAN"')
    expect(html).toContain('data-selection-state="selected"')
    expect(html).toContain('Keep the product demo.')
    expect(html).toContain('00:10')
    expect(html).toContain('00:40')
    expect(html).toContain('proposals.requested')
    expect(html).toContain('proposals.selected')
    expect(html).toContain('data-testid="cut-ranges-timeline"')
  })

  it('shows activated + locked marks and disables non-selected cards when locked', () => {
    const proposal: MediaSummaryProposal = {
      ...baseProposal,
      planKind: 'CUT_PLAN',
      cut_ranges: [{ start_ms: 0, end_ms: 30_000 }],
    }

    const selectedHtml = renderToStaticMarkup(
      <ProposalCard
        proposal={proposal}
        job={{ ...baseJob, selectedProposalId: proposal.id }}
        selectionState="activated"
        selectionLocked
        requestedSec={30}
        onSelect={() => undefined}
        busy={false}
        canSelect
      />,
    )
    expect(selectedHtml).toContain('data-selection-state="activated"')
    expect(selectedHtml).toContain('proposals.activated')
    expect(selectedHtml).toContain('proposals.locked')
    expect(selectedHtml).toContain('disabled')

    const otherHtml = renderToStaticMarkup(
      <ProposalCard
        proposal={{ ...proposal, id: 'other' }}
        job={{ ...baseJob, selectedProposalId: proposal.id }}
        selectionState="candidate"
        selectionLocked
        requestedSec={30}
        onSelect={() => undefined}
        busy={false}
        canSelect
      />,
    )
    expect(otherHtml).toContain('locked-out')
    expect(otherHtml).toContain('disabled')
  })
})

function fullJob(partial: Partial<MediaJob> = {}): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'HYBRID',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: 60,
    selectedProposalId: null,
    createdAt: '2026-01-01T00:00:00Z',
    stages: [
      {
        id: 's1',
        stageName: 'SUMMARIZE',
        stageOrder: 3,
        status: 'COMPLETED',
        progressPercent: 100,
        startedAt: null,
        completedAt: '2026-01-01T00:00:01Z',
      },
    ],
    recipeId: 'summary.generative',
    ...partial,
  }
}

describe('ProposalPanel refine UI', () => {
  beforeEach(() => {
    refineMutateAsync.mockReset()
  })

  it('shows refine trigger and direct review for generative jobs, and opens modal form', () => {
    const defaultHtml = renderToStaticMarkup(
      <ProposalPanel workspaceId="ws-1" job={fullJob({ recipeId: 'summary.generative' })} />,
    )
    expect(defaultHtml).toContain('data-testid="narrative-refine-open-btn"')
    expect(defaultHtml).toContain('data-testid="narrative-plan-review-container"')
    expect(defaultHtml).toContain('data-testid="narrative-plan-viewer"')

    // When modal is open
    const modalHtml = renderToStaticMarkup(
      <ProposalPanel
        workspaceId="ws-1"
        job={fullJob({ recipeId: 'summary.generative' })}
        initialRefineModalOpen
      />,
    )
    expect(modalHtml).toContain('data-testid="narrative-refine-form"')
    expect(modalHtml).toContain('data-testid="narrative-refine-feedback"')
    expect(modalHtml).toContain('data-testid="narrative-refine-submit"')
    expect(modalHtml).toContain('data-testid="refine-modal-coverage-timeline"')
    expect(modalHtml).toContain('disabled')
  })

  it('hides refine modal trigger and form for extractive jobs', () => {
    const html = renderToStaticMarkup(
      <ProposalPanel
        workspaceId="ws-1"
        job={fullJob({ recipeId: 'summary.extractive', processingMode: 'HYBRID' })}
      />,
    )
    expect(html).not.toContain('data-testid="narrative-refine-open-btn"')
    expect(html).not.toContain('data-testid="narrative-refine-form"')
  })

  it('hides refine modal trigger and form when selection is locked', () => {
    const html = renderToStaticMarkup(
      <ProposalPanel
        workspaceId="ws-1"
        job={fullJob({
          recipeId: 'summary.generative',
          selectedProposalId: 'proposal-1',
          translationJobId: 'tj-1',
          stages: [
            {
              id: 's1',
              stageName: 'SUMMARIZE',
              stageOrder: 3,
              status: 'COMPLETED',
              progressPercent: 100,
              startedAt: null,
              completedAt: '2026-01-01T00:00:01Z',
            },
            {
              id: 's2',
              stageName: 'TRANSLATE',
              stageOrder: 4,
              status: 'COMPLETED',
              progressPercent: 100,
              startedAt: null,
              completedAt: '2026-01-01T00:00:02Z',
            },
          ],
        })}
      />,
    )
    expect(html).not.toContain('data-testid="narrative-refine-open-btn"')
    expect(html).not.toContain('data-testid="narrative-refine-form"')
    // Requirement 3: Locked pill near "Tạo lại đề xuất AI" in section header must NOT be rendered for generative
    expect(html).not.toContain('media-proposal-state-pill locked">')
    // Requirement 4: Reviewed and locked badge is displayed instead of agree button
    expect(html).toContain('data-testid="narrative-reviewed-badge"')
    expect(html).toContain('media:proposals.reviewedAndLocked')
    expect(html).not.toContain('data-testid="narrative-approve-btn"')
  })

  it('shows agreeNextStep button and refine trigger before narrative is reviewed and locked', () => {
    const html = renderToStaticMarkup(
      <ProposalPanel workspaceId="ws-1" job={fullJob({ recipeId: 'summary.generative' })} />,
    )
    // Requirement 4: Button "Đồng ý, bước kế" displayed before review
    expect(html).toContain('data-testid="narrative-approve-btn"')
    expect(html).toContain('media:proposals.agreeNextStep')
    expect(html).toContain('data-testid="narrative-refine-modal-trigger"')
    expect(html).not.toContain('data-testid="narrative-reviewed-badge"')
  })
})
