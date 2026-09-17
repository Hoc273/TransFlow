// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { StageRerunDropdown } from './StageRerunDropdown'
import type { MediaJob } from '@/types/media'

afterEach(() => {
  cleanup()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.stage) return `${key}:${String(options.stage)}`
      return key
    },
  }),
}))

function mockJob(partial: Partial<MediaJob> = {}): MediaJob {
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
    recipeId: 'summary.generative',
    stages: [
      {
        id: 's1',
        stageName: 'EXTRACT_AUDIO',
        stageOrder: 1,
        status: 'COMPLETED',
        progressPercent: 100,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's2',
        stageName: 'STT',
        stageOrder: 2,
        status: 'COMPLETED',
        progressPercent: 100,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's3',
        stageName: 'SUMMARIZE',
        stageOrder: 3,
        status: 'COMPLETED',
        progressPercent: 100,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's4',
        stageName: 'TRANSLATE',
        stageOrder: 4,
        status: 'PENDING',
        progressPercent: 0,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's5',
        stageName: 'TTS',
        stageOrder: 5,
        status: 'PENDING',
        progressPercent: 0,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's6',
        stageName: 'AUDIO_MIX',
        stageOrder: 6,
        status: 'SKIPPED',
        progressPercent: 0,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's7',
        stageName: 'RENDER',
        stageOrder: 7,
        status: 'PENDING',
        progressPercent: 0,
        startedAt: null,
        completedAt: null,
      },
    ],
    ...partial,
  }
}

describe('StageRerunDropdown', () => {
  it('renders trigger button with rerun label and opens menu with eligible stages', () => {
    const onRerun = vi.fn()
    const job = mockJob()

    render(<StageRerunDropdown job={job} canEdit={true} onRerun={onRerun} />)

    const trigger = screen.getByTestId('stage-rerun-dropdown-trigger') as HTMLButtonElement
    expect(trigger).toBeTruthy()
    expect(trigger.disabled).toBe(false)

    // Open dropdown
    fireEvent.click(trigger)

    expect(screen.getByTestId('stage-rerun-menu')).toBeTruthy()
    // Up to TRANSLATE (order 4) - eligible: EXTRACT_AUDIO (1), STT (2), SUMMARIZE (3), TRANSLATE (4)
    expect(screen.getByTestId('stage-rerun-item-EXTRACT_AUDIO')).toBeTruthy()
    expect(screen.getByTestId('stage-rerun-item-STT')).toBeTruthy()
    expect(screen.getByTestId('stage-rerun-item-SUMMARIZE')).toBeTruthy()
    expect(screen.getByTestId('stage-rerun-item-TRANSLATE')).toBeTruthy()

    // TTS (5) and RENDER (7) exceed current stage (4), AUDIO_MIX (6) is SKIPPED -> should NOT be in menu
    expect(screen.queryByTestId('stage-rerun-item-TTS')).toBeNull()
    expect(screen.queryByTestId('stage-rerun-item-AUDIO_MIX')).toBeNull()
    expect(screen.queryByTestId('stage-rerun-item-RENDER')).toBeNull()
  })

  it('disables trigger button when any stage is actively processing', () => {
    const onRerun = vi.fn()
    const job = mockJob({
      stages: [
        {
          id: 's1',
          stageName: 'EXTRACT_AUDIO',
          stageOrder: 1,
          status: 'COMPLETED',
          progressPercent: 100,
          startedAt: null,
          completedAt: null,
        },
        {
          id: 's2',
          stageName: 'STT',
          stageOrder: 2,
          status: 'PROCESSING',
          progressPercent: 50,
          startedAt: null,
          completedAt: null,
        },
      ],
    })

    render(<StageRerunDropdown job={job} canEdit={true} onRerun={onRerun} />)

    const trigger = screen.getByTestId('stage-rerun-dropdown-trigger') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })

  it('opens confirmation modal and executes onRerun on confirm', async () => {
    const onRerun = vi.fn()
    const job = mockJob()

    render(<StageRerunDropdown job={job} canEdit={true} onRerun={onRerun} />)

    // Open dropdown
    fireEvent.click(screen.getByTestId('stage-rerun-dropdown-trigger'))

    // Select SUMMARIZE
    fireEvent.click(screen.getByTestId('stage-rerun-item-SUMMARIZE'))

    // Confirm modal should appear
    expect(screen.getByTestId('stage-rerun-confirm-btn')).toBeTruthy()

    // Click confirm
    fireEvent.click(screen.getByTestId('stage-rerun-confirm-btn'))

    expect(onRerun).toHaveBeenCalledWith('SUMMARIZE')
  })

  it('cancels confirmation modal without invoking onRerun', () => {
    const onRerun = vi.fn()
    const job = mockJob()

    render(<StageRerunDropdown job={job} canEdit={true} onRerun={onRerun} />)

    fireEvent.click(screen.getByTestId('stage-rerun-dropdown-trigger'))
    fireEvent.click(screen.getByTestId('stage-rerun-item-STT'))

    expect(screen.getByTestId('stage-rerun-confirm-btn')).toBeTruthy()

    // Click cancel
    fireEvent.click(screen.getByText('common:actions.cancel'))

    expect(onRerun).not.toHaveBeenCalled()
    expect(screen.queryByTestId('stage-rerun-confirm-btn')).toBeNull()
  })
})
