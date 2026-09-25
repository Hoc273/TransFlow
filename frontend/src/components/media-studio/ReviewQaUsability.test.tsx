// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => cleanup())

const { editMutate, overrideMutate } = vi.hoisted(() => ({
  editMutate: vi.fn(() => Promise.resolve({})),
  overrideMutate: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${options.count}` : key,
  }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaSubtitles: () => ({ data: cues, isLoading: false }),
  useMediaJobQaIssues: () => ({ data: issues, isLoading: false }),
  useEditMediaSegment: () => ({ isPending: false, mutateAsync: editMutate }),
  useBatchEditMediaSegments: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRerunTtsRender: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOverrideQaIssue: () => ({ isPending: false, mutate: overrideMutate, variables: null }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

vi.mock('@/config/featureFlags', () => ({
  featureFlags: { qaOverride: true },
}))

const { MediaSubtitleEditor } = await import('@/components/media-studio/MediaSubtitleEditor')
const { MediaQaPanel } = await import('@/components/media-studio/MediaQaPanel')
const { PipelineStepper } = await import('@/components/media-studio/PipelineStepper')

import type { MediaJob } from '@/types/media'
import type { QaIssue } from '@/types/qa'

const cues = [
  { id: 'seg-1', seq: 1, sourceText: 'Xin chào', targetText: 'Hello', startMs: 1000, endMs: 4000 },
  { id: 'seg-2', seq: 2, sourceText: 'Hẹn gặp lại', targetText: 'See you', startMs: 5000, endMs: 8000 },
]

const accuracy: QaIssue = {
  id: 'qa-accuracy',
  type: 'accuracy',
  severity: 'CRITICAL',
  message: 'The translated text is identical to the source text.',
  sourceSpan: null,
  targetSpan: null,
  suggestion: null,
  resolved: false,
  blockingActions: ['BLOCK_RENDER', 'BLOCK_PUBLISH'],
  subtitleSegmentId: 'seg-2',
}
const overlap: QaIssue = {
  ...accuracy,
  id: 'qa-overlap',
  type: 'subtitle_overlap',
  message: 'Subtitle timing overlaps the previous segment',
  blockingActions: ['BLOCK_RENDER'],
  subtitleSegmentId: 'seg-1',
}
const fluency: QaIssue = {
  ...accuracy,
  id: 'qa-fluency',
  type: 'fluency',
  severity: 'LOW',
  message: 'Slightly awkward.',
  blockingActions: [],
  subtitleSegmentId: 'seg-1',
}
let issues: QaIssue[] = []

function job(stages: MediaJob['stages'] = []): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'vi',
    targetLang: 'en',
    status: 'PROCESSING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    translationJobId: null,
    createdAt: '2026-09-25T00:00:00Z',
    stages,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  issues = [fluency, accuracy, overlap]
})

describe('QA panel tells the user what blocks the render and how to unblock it', () => {
  it('summarises blocking issues and jumps to the first one', () => {
    const onSelectIssue = vi.fn()
    render(<MediaQaPanel workspaceId="ws" job={job()} onSelectIssue={onSelectIssue} />)

    expect(screen.getByText('qa.blockingTitle:2')).not.toBeNull()
    expect(screen.getByText('qa.otherOpen:1')).not.toBeNull()
    fireEvent.click(screen.getByTestId('qa-first-blocking'))
    expect(onSelectIssue).toHaveBeenCalledTimes(1)

    // Blocking issues are listed before the non-blocking one.
    const rows = [...document.querySelectorAll('[data-testid^="review-issue-row-"]')]
    expect(rows.at(-1)?.getAttribute('data-testid')).toBe('review-issue-row-qa-fluency')
  })

  it('shows the flagged subtitle, a readable type and one action per way out', () => {
    render(<MediaQaPanel workspaceId="ws" job={job()} onSelectIssue={vi.fn()} />)

    const row = screen.getByTestId('review-issue-row-qa-accuracy')
    expect(row.textContent).toContain('See you')
    expect(row.textContent).toContain('qa.types.accuracy')
    expect(row.textContent).toContain('qa.blocks.BLOCK_RENDER')
    expect(screen.getByTestId('qa-fix-qa-accuracy')).not.toBeNull()
    expect(screen.getByTestId('qa-skip-qa-accuracy')).not.toBeNull()
  })

  it('never offers to skip a critical overlap and explains why', () => {
    render(<MediaQaPanel workspaceId="ws" job={job()} onSelectIssue={vi.fn()} />)

    expect(screen.queryByTestId('qa-skip-qa-overlap')).toBeNull()
    expect(screen.getByTestId('review-issue-row-qa-overlap').textContent).toContain(
      'qa.overlapNotSkippable',
    )
  })

  it('skipping a check submits the chosen reason preset', () => {
    render(<MediaQaPanel workspaceId="ws" job={job()} onSelectIssue={vi.fn()} />)

    fireEvent.click(screen.getByTestId('qa-skip-qa-accuracy'))
    fireEvent.click(screen.getByTestId('override-preset-authored'))
    fireEvent.click(screen.getByText('qa.overrideModal.submit'))

    expect(overrideMutate).toHaveBeenCalledTimes(1)
    const [{ issueId, body }] = overrideMutate.mock.calls[0] as unknown as [
      { issueId: string; body: { reason: string } },
    ]
    expect(issueId).toBe('qa-accuracy')
    expect(body.reason).toBe('qa.overrideModal.presets.authored')
  })
})

describe('Subtitle editor timing tools', () => {
  it('shows the source under the translation without opening the row', () => {
    render(<MediaSubtitleEditor workspaceId="ws" job={job()} />)

    expect(screen.getByTestId('subtitle-source-2').textContent).toBe('Hẹn gặp lại')
  })

  it('lists the line issues, takes the video time, nudges and saves with Ctrl+Enter', async () => {
    render(<MediaSubtitleEditor workspaceId="ws" job={job()} playingTimeMs={5250} />)

    fireEvent.click(screen.getByTestId('subtitle-row-head-2'))
    expect(screen.getByTestId('subtitle-line-issues-2').textContent).toContain('qa.types.accuracy')

    fireEvent.click(screen.getByTestId('subtitle-use-time-startMs-2'))
    expect((screen.getByTestId('subtitle-startMs-2') as HTMLInputElement).value).toBe('0:05.250')
    fireEvent.click(screen.getAllByLabelText('media:subtitles.nudgeLater')[0])
    expect((screen.getByTestId('subtitle-startMs-2') as HTMLInputElement).value).toBe('0:05.350')

    fireEvent.keyDown(screen.getByTestId('subtitle-target-2'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(editMutate).toHaveBeenCalledTimes(1))
    expect((editMutate.mock.calls as unknown[][])[0][0]).toEqual({
      segmentId: 'seg-2',
      body: { targetText: 'See you', startMs: 5350, endMs: 8000 },
    })
  })

  it('warns when the line is too fast to read', () => {
    render(<MediaSubtitleEditor workspaceId="ws" job={job()} />)

    fireEvent.click(screen.getByTestId('subtitle-row-head-1'))
    fireEvent.change(screen.getByTestId('subtitle-target-1'), {
      target: { value: 'A very long line that nobody could possibly read within three seconds on screen' },
    })
    expect(screen.getByTestId('subtitle-stats-1').className).toContain('fast')
  })
})

describe('Pipeline stepper', () => {
  it('shows RENDER as waiting for QA instead of a silent pending stage', () => {
    render(
      <PipelineStepper
        job={job([
          {
            id: 'st-render',
            stageName: 'RENDER',
            stageOrder: 8,
            status: 'PENDING',
            progressPercent: 0,
            errorCode: 'QA_BLOCKED',
            errorMessage: 'Render is waiting for QA review: 1 issue blocks rendering',
            startedAt: null,
            completedAt: null,
          },
        ])}
      />,
    )

    expect(screen.getByText('pipeline.waitingForQa')).not.toBeNull()
    expect(screen.getByTestId('stage-waiting-qa')).not.toBeNull()
  })
})
