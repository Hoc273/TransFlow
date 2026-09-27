// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => cleanup())

const { batchMutate, editMutate, resolveMutate, overrideMutate } = vi.hoisted(() => ({
  batchMutate: vi.fn(() => Promise.resolve({ segments: [] })),
  editMutate: vi.fn(() => Promise.resolve({})),
  resolveMutate: vi.fn(),
  overrideMutate: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaLinkedJob: () => ({ data: { segments: segments }, isLoading: false }),
  useMediaSubtitles: () => ({ data: cuesOf(segments), isLoading: false }),
  useMediaJobQaIssues: () => ({ data: issuesOf(segments), isLoading: false }),
  useEditMediaSegment: () => ({ isPending: false, mutateAsync: editMutate }),
  useBatchEditMediaSegments: () => ({ isPending: false, mutateAsync: batchMutate }),
  useRerunTtsRender: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useResolveQaIssue: () => ({ isPending: false, mutate: resolveMutate, variables: null }),
  useOverrideQaIssue: () => ({ isPending: false, mutate: overrideMutate, variables: null }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

const { MediaSubtitleEditor } = await import('@/components/media-studio/MediaSubtitleEditor')
const { MediaQaPanel } = await import('@/components/media-studio/MediaQaPanel')
const { ReviewVideoPane } = await import('@/components/media-studio/ReviewVideoPane')

import type { MediaJob, SegmentItem } from '@/types/media'
import type { QaIssue } from '@/types/qa'

// The editor/QA panel read cues from useMediaSubtitles and issues from
// useMediaJobQaIssues; derive both from the SegmentItem fixtures. Results are
// cached by fixture content so the mocked hooks return stable references while the
// data is unchanged (like react-query) — a fresh array on every render would loop
// the component's effects — yet still reflect tests that mutate a fixture.
const cueCache = new Map<string, unknown[]>()
const issueCache = new Map<string, unknown[]>()

function cached(cache: Map<string, unknown[]>, items: SegmentItem[], build: () => unknown[]) {
  const key = JSON.stringify(items)
  if (!cache.has(key)) cache.set(key, build())
  return cache.get(key)
}

function cuesOf(items: SegmentItem[]) {
  return cached(cueCache, items, () =>
    items.map((s) => ({
      id: s.id,
      seq: s.seq,
      sourceText: s.sourceText,
      targetText: s.targetText,
      startMs: s.startMs ?? 0,
      endMs: s.endMs ?? 0,
    })),
  )
}

function issuesOf(items: SegmentItem[]) {
  return cached(issueCache, items, () =>
    items.flatMap((s) => (s.qaIssues ?? []).map((q) => ({ ...q, subtitleSegmentId: s.id }))),
  )
}

const segments: SegmentItem[] = [
  {
    id: 'seg-1',
    seq: 1,
    sourceText: 'Hello',
    targetText: 'Xin chào',
    status: 'TRANSLATED',
    tmScore: null,
    qaIssues: [],
    startMs: 1000,
    endMs: 4000,
  },
  {
    id: 'seg-2',
    seq: 2,
    sourceText: 'See you',
    targetText: 'Hẹn gặp lại',
    status: 'TRANSLATED',
    tmScore: null,
    qaIssues: [
      {
        id: 'qa-1',
        type: 'cps_exceeded',
        severity: 'CRITICAL',
        message: 'too fast',
        sourceSpan: null,
        targetSpan: null,
        suggestion: null,
        resolved: false,
      },
    ],
    startMs: 5000,
    endMs: 8000,
  },
]

function job(): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    translationJobId: 'tj-1',
    createdAt: '2026-08-12T00:00:00Z',
    stages: [],
  }
}

const issue: QaIssue = segments[1].qaIssues![0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Review workbench — cue list batch save (§1.8.2 redesign)', () => {
  it('save-all publishes one batch call with every dirty cue', async () => {
    render(<MediaSubtitleEditor workspaceId="ws" job={job()} />)

    // Open both rows and dirty them.
    fireEvent.click(screen.getByTestId('subtitle-row-head-1'))
    fireEvent.change(await screen.findByDisplayValue('Xin chào'), {
      target: { value: 'Xin chào!' },
    })
    fireEvent.click(screen.getByTestId('subtitle-row-head-2'))
    fireEvent.change(await screen.findByDisplayValue('Hẹn gặp lại'), {
      target: { value: 'Hẹn gặp lại nhé' },
    })

    const saveAll = screen.getByTestId('subtitle-save-all')
    expect(saveAll).not.toBeNull()
    fireEvent.click(saveAll)

    await waitFor(() => expect(batchMutate).toHaveBeenCalledTimes(1))
    expect(editMutate).not.toHaveBeenCalled()
    expect((batchMutate.mock.calls as unknown[][])[0][0]).toEqual([
      { segmentId: 'seg-1', targetText: 'Xin chào!', startMs: 1000, endMs: 4000 },
      { segmentId: 'seg-2', targetText: 'Hẹn gặp lại nhé', startMs: 5000, endMs: 8000 },
    ])
  })

  it('save-all validates every dirty cue and names the failing seq', async () => {
    render(<MediaSubtitleEditor workspaceId="ws" job={job()} />)

    fireEvent.click(screen.getByTestId('subtitle-row-head-1'))
    fireEvent.change(await screen.findByDisplayValue('Xin chào'), {
      target: { value: 'Chào' },
    })
    // end before start — invalid.
    fireEvent.change(screen.getByDisplayValue('0:04.000'), { target: { value: '0:00.500' } })

    fireEvent.click(screen.getByTestId('subtitle-save-all'))

    await waitFor(() =>
      expect(screen.getByText('media:subtitles.invalidRangeSeq')).not.toBeNull(),
    )
    expect(batchMutate).not.toHaveBeenCalled()
  })

  it('filter chips + search narrow the cue list', () => {
    render(<MediaSubtitleEditor workspaceId="ws" job={job()} />)

    expect(screen.getByTestId('subtitle-row-1')).not.toBeNull()
    expect(screen.getByTestId('subtitle-row-2')).not.toBeNull()

    fireEvent.click(screen.getByTestId('subtitle-filter-qa'))
    expect(screen.queryByTestId('subtitle-row-1')).toBeNull()
    expect(screen.getByTestId('subtitle-row-2')).not.toBeNull()

    fireEvent.click(screen.getByTestId('subtitle-filter-all'))
    fireEvent.change(screen.getByTestId('subtitle-search'), { target: { value: 'hẹn' } })
    expect(screen.queryByTestId('subtitle-row-1')).toBeNull()
    expect(screen.getByTestId('subtitle-row-2')).not.toBeNull()
  })
})

describe('Review workbench — actionable QA strip (§1.8.2 redesign)', () => {
  it('clicking an issue row jumps to its cue; no Resolve action is offered', () => {
    const onSelectIssue = vi.fn()
    render(<MediaQaPanel workspaceId="ws" job={job()} onSelectIssue={onSelectIssue} />)

    // The row's main button (not the action buttons) performs the cue jump.
    fireEvent.click(
      screen.getByTestId(`review-issue-row-${issue.id}`).querySelector('button')!,
    )
    expect(onSelectIssue).toHaveBeenCalledTimes(1)
    expect(onSelectIssue.mock.calls[0][0].id).toBe('seg-2')

    // Resolve was removed with the text-translation QA flow (17f5957); only Override remains.
    expect(screen.queryByText('job:qa.resolve')).toBeNull()
    expect(resolveMutate).not.toHaveBeenCalled()
  })
})

describe('Review workbench — video pane (§1.8.2 redesign)', () => {
  it('renders the QA band summary and the pending placeholder without a URL', () => {
    const videoRef = { current: null }
    render(
      <ReviewVideoPane
        videoRef={videoRef}
        videoUrl={null}
        segments={segments}
        qaCounts={{ high: 2, medium: 1, low: 0 }}
        selectedCueId={null}
      />,
    )

    expect(screen.getByTestId('review-qa-summary')).not.toBeNull()
    expect(screen.getByText('review.videoPending')).not.toBeNull()
  })
})
