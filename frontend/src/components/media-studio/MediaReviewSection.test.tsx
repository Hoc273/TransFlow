// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => cleanup())

const { reviewData } = vi.hoisted(() => ({
  reviewData: { subtitles: [] as unknown[], issues: [] as unknown[] },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaSubtitles: () => ({ data: reviewData.subtitles, isLoading: false }),
  useMediaJobQaIssues: () => ({ data: reviewData.issues, isLoading: false }),
  useEditMediaSegment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useBatchEditMediaSegments: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRerunTtsRender: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRenderConfig: () => ({ data: null }),
  useResolveQaIssue: () => ({ isPending: false, mutate: vi.fn(), variables: null }),
  useOverrideQaIssue: () => ({ isPending: false, mutate: vi.fn(), variables: null }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

const { MediaReviewSection } = await import('./MediaReviewSection')
import type { MediaJob, JobDetail } from '@/types/media'
import type { QaIssue } from '@/types/qa'

function job(translationJobId: string | null): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-08-12T00:00:00Z',
    translationJobId,
    stages: [],
  }
}

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

function linkedJob(): JobDetail {
  return {
    id: 'linked-1',
    documentId: 'doc-1',
    targetLang: 'vi',
    status: 'TRANSLATED',
    providerUsed: null,
    modelUsed: null,
    segments: [
      {
        id: 'seg-1',
        seq: 1,
        sourceText: 'Hello world',
        targetText: 'Xin chào thế giới',
        status: 'TRANSLATED',
        tmScore: null,
        startMs: 1000,
        endMs: 4000,
        qaIssues: [
          issue({ id: 'i-high', severity: 'HIGH' }),
          issue({ id: 'i-critical', severity: 'CRITICAL' }),
          issue({ id: 'i-medium', severity: 'MEDIUM' }),
          issue({ id: 'i-low', severity: 'LOW' }),
          issue({ id: 'i-resolved', severity: 'HIGH', resolved: true }),
        ],
      },
    ],
  }
}

function setReviewData(detail: JobDetail) {
  reviewData.subtitles = detail.segments.map(({ id, seq, sourceText, targetText, startMs, endMs }) =>
    ({ id, seq, sourceText, targetText, startMs, endMs }),
  )
  reviewData.issues = detail.segments.flatMap((seg) =>
    seg.qaIssues.map((qa) => ({ ...qa, subtitleSegmentId: seg.id })),
  )
}

describe('MediaReviewSection — QA + Subtitles review workbench (docs/19 §1.8.2 redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewData.subtitles = []
    reviewData.issues = []
  })

  it('renders actionable QA rows without the old severity-band cards', () => {
    setReviewData(linkedJob())
    render(<MediaReviewSection workspaceId="ws" job={job('linked-1')} />)

    // Band cards were replaced by the accordion-trigger pill — never rendered here.
    expect(screen.queryByTestId('qa-severity-bands')).toBeNull()
    expect(screen.queryByTestId('media-qa-panel')).not.toBeNull()

    // 4 open issues (the resolved one stays hidden while collapsed);
    // 5 <= the visible limit, so no "show more" toggle appears.
    const rows = document.querySelectorAll('[data-testid^="review-issue-row-"]')
    expect(rows.length).toBe(4)
    expect(screen.queryByTestId('qa-show-more')).toBeNull()
  })

  it('expands beyond 5 issues via the show-more toggle', async () => {
    const many = linkedJob()
    const seg = many.segments[0]
    seg.qaIssues = Array.from({ length: 8 }, (_, i) =>
      issue({ id: `i-${i}`, severity: i % 2 === 0 ? 'HIGH' : 'LOW' }),
    )
    setReviewData(many)
    render(<MediaReviewSection workspaceId="ws" job={job('linked-1')} />)

    // Collapsed: only the first 5 open issues render.
    expect(document.querySelectorAll('[data-testid^="review-issue-row-"]').length).toBe(5)
    const toggle = screen.getByTestId('qa-show-more')
    expect(toggle.textContent).toContain('qa.showMore')

    toggle.click()
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="review-issue-row-"]').length).toBe(8)
    })
  })

  it('opens the inline cue editor from the cue row while the QA strip stays visible', async () => {
    setReviewData(linkedJob())
    render(<MediaReviewSection workspaceId="ws" job={job('linked-1')} />)

    const section = screen.getByTestId('media-review-section')
    expect(section.querySelector('[data-testid="media-qa-panel"]')).not.toBeNull()
    expect(section.querySelector('.media-subtitle-editor')).not.toBeNull()

    // Collapsed row shows the target preview + original-timeline preview…
    expect(screen.getByText('Xin chào thế giới')).not.toBeNull()
    const timePreview = section.querySelector('.media-subtitle-time-preview')
    expect(timePreview?.textContent).toContain('00:01')
    expect(timePreview?.textContent).toContain('00:04')

    // …clicking the row opens the inline editor: source + textarea + timing.
    fireEvent.click(screen.getByTestId('subtitle-row-head-1'))
    expect(await screen.findByDisplayValue('Xin chào thế giới')).not.toBeNull()
    expect(screen.getByDisplayValue('1000')).not.toBeNull()
    expect(screen.getByDisplayValue('4000')).not.toBeNull()
    expect(screen.getByText('Hello world')).not.toBeNull()
  })

  it('shows an empty review when the media job has no subtitles yet', () => {
    render(<MediaReviewSection workspaceId="ws" job={job(null)} />)

    expect(screen.getByTestId('media-review-section')).not.toBeNull()
    expect(screen.getByText('qa.noneOpen')).not.toBeNull()
    expect(screen.getByText('media:subtitles.emptyTitle')).not.toBeNull()
  })

  it('triggers onProceedToNextStep when next step button is clicked', () => {
    setReviewData(linkedJob())
    const onNext = vi.fn()
    render(
      <MediaReviewSection
        workspaceId="ws"
        job={job('linked-1')}
        onProceedToNextStep={onNext}
      />,
    )

    const nextBtn = screen.getByTestId('subtitle-next-step')
    expect(nextBtn).not.toBeNull()
    fireEvent.click(nextBtn)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
