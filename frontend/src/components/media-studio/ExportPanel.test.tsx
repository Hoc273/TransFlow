// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => cleanup())

const { linkedJobData, exportMutate, outputPackageData, outputPackageCalls, openSpy } = vi.hoisted(() => ({
  linkedJobData: { data: undefined as unknown, isLoading: false },
  exportMutate: vi.fn(),
  outputPackageData: { data: undefined as unknown, error: undefined as unknown, isError: false, isPending: false },
  outputPackageCalls: vi.fn(),
  openSpy: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaLinkedJob: () => linkedJobData,
  useExportMediaJob: () => ({ isPending: false, mutateAsync: exportMutate }),
  useOutputPackage: (workspaceId: string, jobId: string, enabled: boolean) => {
    outputPackageCalls(workspaceId, jobId, enabled)
    return outputPackageData
  },
}))

vi.mock('@/api/transformation', () => ({
  exportTransformationJobApi: vi.fn(() => new Promise(() => {})),
}))

const { ExportPanel } = await import('./ExportPanel')
import { ApiError } from '@/types/api'
import type { MediaJob, JobDetail } from '@/types/media'
import type { QaIssue } from '@/types/qa'

function job(partial: Partial<MediaJob>): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'COMPLETED',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-08-12T00:00:00Z',
    translationJobId: 'linked-1',
    stages: [
      {
        id: 's0',
        stageName: 'TRANSLATE',
        stageOrder: 3,
        status: 'COMPLETED',
        progressPercent: 100,
        outputRef: null,
        startedAt: null,
        completedAt: null,
      },
      {
        id: 's1',
        stageName: 'RENDER',
        stageOrder: 6,
        status: 'COMPLETED',
        progressPercent: 100,
        outputRef: 'rendered-video.mp4',
        startedAt: null,
        completedAt: null,
      },
    ],
    ...partial,
  }
}

function linkedJob(segments: JobDetail['segments']): JobDetail {
  return {
    id: 'linked-1',
    documentId: 'doc-1',
    targetLang: 'vi',
    status: 'COMPLETED',
    providerUsed: null,
    modelUsed: null,
    segments,
  }
}

function blockingIssue(): QaIssue {
  return {
    id: 'i1',
    type: 'subtitle_overlap',
    severity: 'CRITICAL',
    message: 'overlap',
    sourceSpan: null,
    targetSpan: null,
    suggestion: null,
    resolved: false,
    blockingActions: ['BLOCK_EXPORT'],
  }
}

describe('ExportPanel — video deliverables list with 2-column view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    linkedJobData.data = undefined
    linkedJobData.isLoading = false
    outputPackageData.data = undefined
    outputPackageData.error = undefined
    outputPackageData.isError = false
    outputPackageCalls.mockReset()
    exportMutate.mockReset()
    exportMutate.mockImplementation(async (format: string) =>
      format === 'VIDEO'
        ? { downloadUrl: 'https://dl.test/video.mp4', fileName: 'video.mp4' }
        : {
            content: '1\n00:00:01,000 --> 00:00:02,000\nXin chào\n',
            fileName: 'job.srt',
          },
    )
    openSpy.mockReset()
    Object.defineProperty(window, 'open', {
      configurable: true,
      writable: true,
      value: openSpy,
    })
  })

  it('renders the video deliverables list with video info and quick download buttons', () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    expect(screen.getByTestId('export-video-list')).toBeTruthy()
    expect(screen.getByTestId('export-video-item')).toBeTruthy()
    expect(screen.getByTestId('export-video-row')).toBeTruthy()
    expect(screen.getByTestId('export-quick-download-video')).toBeTruthy()
    expect(screen.getByTestId('export-quick-download-srt')).toBeTruthy()
    expect(screen.getByTestId('export-quick-download-vtt')).toBeTruthy()
  })

  it('details stay collapsed until a row is clicked, then opens 2-column view', () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    expect(screen.queryByTestId('export-video-detail')).toBeNull()
    fireEvent.click(screen.getByTestId('export-video-row'))

    const detail = screen.getByTestId('export-video-detail')
    expect(detail).toBeTruthy()
    expect(screen.getByTestId('export-video-preview')).toBeTruthy()
    expect(screen.getByTestId('export-download-video')).toBeTruthy()
    expect(screen.getByTestId('export-sub-item-srt')).toBeTruthy()
    expect(screen.getByTestId('export-sub-item-vtt')).toBeTruthy()
    expect(screen.getByTestId('export-download-srt')).toBeTruthy()
    expect(screen.getByTestId('export-download-vtt')).toBeTruthy()

    // Clicking again collapses it
    fireEvent.click(screen.getByTestId('export-video-row'))
    expect(screen.queryByTestId('export-video-detail')).toBeNull()
  })

  it('auto-expands the video item and streams the presigned output for preview', () => {
    outputPackageData.data = {
      jobId: 'job-1',
      primaryVideoDownloadUrl: 'https://preview.test/video.mp4',
      durationMs: 131000,
      subtitleTracks: [],
      audioTracks: [],
      artifactPins: [],
    }
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    // When videoUrl exists → auto-expands into 2-column view without manual click
    const preview = screen.getByTestId('export-video-preview')
    expect(preview.querySelector('video')).toBeTruthy()
    const video = preview.querySelector('video') as HTMLVideoElement
    expect(video.src).toBe('https://preview.test/video.mp4')
    expect(screen.getByTestId('export-video-detail').textContent).toContain('2:11')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('uses a completed RENDER storage ref for package loading and the displayed file name', () => {
    linkedJobData.data = linkedJob([])
    outputPackageData.data = {
      jobId: 'job-1',
      primaryVideoRef: 'transflow-media/rendered/j/abc.mp4',
      primaryVideoDownloadUrl: 'https://preview.test/video.mp4',
      durationMs: 131000,
      subtitleTracks: [],
      audioTracks: [],
      artifactPins: [],
    }

    render(
      <ExportPanel
        workspaceId="ws"
        job={job({
          stages: [{
            id: 's1',
            stageName: 'RENDER',
            stageOrder: 6,
            status: 'COMPLETED',
            progressPercent: 100,
            outputRef: 'transflow-media/rendered/j/abc.mp4',
            startedAt: null,
            completedAt: null,
          }],
        })}
      />,
    )

    expect(outputPackageCalls).toHaveBeenCalledWith('ws', 'job-1', true)
    expect(screen.queryByText('media:export.needArtifactDesc')).toBeNull()
    expect(screen.getByTestId('export-video-detail').textContent).toContain('abc.mp4')
  })

  it('checks output-package when RENDER is done without a stage output ref', () => {
    linkedJobData.data = linkedJob([])
    outputPackageData.data = {
      jobId: 'job-1',
      primaryVideoRef: 'transflow-media/rendered/j/abc.mp4',
      primaryVideoDownloadUrl: 'https://preview.test/video.mp4',
      durationMs: 131000,
      subtitleTracks: [],
      audioTracks: [],
      artifactPins: [],
    }

    render(
      <ExportPanel
        workspaceId="ws"
        job={job({
          stages: [{
            id: 's1',
            stageName: 'RENDER',
            stageOrder: 6,
            status: 'COMPLETED',
            progressPercent: 100,
            outputRef: null,
            startedAt: null,
            completedAt: null,
          }],
        })}
      />,
    )

    expect(outputPackageCalls).toHaveBeenCalledWith('ws', 'job-1', true)
    expect(screen.queryByText('media:export.needArtifactDesc')).toBeNull()
    expect(screen.getByTestId('export-video-preview').querySelector('video')).toBeTruthy()
  })

  it('shows the missing-artifact message only when output-package reports STAGE_NOT_READY', () => {
    linkedJobData.data = linkedJob([])
    outputPackageData.error = new ApiError({
      status: 409,
      code: '2902',
      message: 'Stage output is not ready',
    })
    outputPackageData.isError = true

    render(
      <ExportPanel
        workspaceId="ws"
        job={job({
          stages: [{
            id: 's1',
            stageName: 'RENDER',
            stageOrder: 6,
            status: 'COMPLETED',
            progressPercent: 100,
            outputRef: null,
            startedAt: null,
            completedAt: null,
          }],
        })}
      />,
    )

    expect(screen.queryByText('media:export.needArtifactDesc')).not.toBeNull()
  })

  it('does not show the missing-artifact message for another output-package error', () => {
    linkedJobData.data = linkedJob([])
    outputPackageData.error = new ApiError({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unexpected error',
    })
    outputPackageData.isError = true

    render(
      <ExportPanel
        workspaceId="ws"
        job={job({
          stages: [{
            id: 's1',
            stageName: 'RENDER',
            stageOrder: 6,
            status: 'COMPLETED',
            progressPercent: 100,
            outputRef: null,
            startedAt: null,
            completedAt: null,
          }],
        })}
      />,
    )

    expect(screen.queryByText('media:export.needArtifactDesc')).toBeNull()
    expect(screen.queryAllByText('media:export.previewUnavailable').length).toBeGreaterThan(0)
  })

  it('primary video download button in detail runs the VIDEO export', async () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    fireEvent.click(screen.getByTestId('export-video-row'))
    fireEvent.click(screen.getByTestId('export-download-video'))
    await waitFor(() => expect(exportMutate).toHaveBeenCalledWith('VIDEO'))
  })

  it('quick download video button on the row runs the VIDEO export directly', async () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    fireEvent.click(screen.getByTestId('export-quick-download-video'))
    await waitFor(() => expect(exportMutate).toHaveBeenCalledWith('VIDEO'))
  })

  it('opens the presigned video URL in a new tab after VIDEO export', async () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    fireEvent.click(screen.getByTestId('export-quick-download-video'))
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://dl.test/video.mp4',
        '_blank',
        'noopener,noreferrer',
      ),
    )
  })

  it('subtitle download buttons in right column run SRT and VTT export', async () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    fireEvent.click(screen.getByTestId('export-video-row'))
    fireEvent.click(screen.getByTestId('export-download-srt'))
    await waitFor(() => expect(exportMutate).toHaveBeenCalledWith('SRT'))

    fireEvent.click(screen.getByTestId('export-download-vtt'))
    await waitFor(() => expect(exportMutate).toHaveBeenCalledWith('VTT'))
  })

  it('lazy-loads the SRT content preview when preview button is clicked (no file download)', async () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    fireEvent.click(screen.getByTestId('export-video-row'))
    fireEvent.click(screen.getByTestId('export-toggle-preview-srt'))

    await waitFor(() =>
      expect(screen.getByTestId('export-sub-preview-srt').textContent).toContain('Xin chào'),
    )
    expect(exportMutate).toHaveBeenCalledWith('SRT')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('disables every download while BLOCK_EXPORT is effective and surfaces the blocked banner', () => {
    linkedJobData.data = linkedJob([
      {
        id: 'seg-1',
        seq: 1,
        sourceText: 'Hello',
        targetText: 'Xin chào',
        status: 'TRANSLATED',
        tmScore: null,
        startMs: null,
        endMs: null,
        qaIssues: [blockingIssue()],
      },
    ])
    render(<ExportPanel workspaceId="ws" job={job({})} />)

    expect(screen.getByText('media:export.blockedTitle')).not.toBeNull()
    expect((screen.getByTestId('export-quick-download-video') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('export-quick-download-srt') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('export-video-row'))
    expect(
      (screen.getByTestId('export-download-video') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('export-download-srt') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(openSpy).not.toHaveBeenCalled()
    expect(exportMutate).not.toHaveBeenCalled()
  })

  it('subtitle downloads stay disabled before TRANSLATE produced segments', () => {
    linkedJobData.data = linkedJob([])
    render(
      <ExportPanel
        workspaceId="ws"
        job={job({ translationJobId: null, stages: [] })}
      />,
    )

    expect((screen.getByTestId('export-quick-download-srt') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('export-video-row'))
    expect(
      (screen.getByTestId('export-download-srt') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByTestId('export-video-detail').textContent).toContain(
      'media:export.needTranslateDesc',
    )
  })

  it('subtitle downloads wait for the whole job even when TRANSLATE is done', () => {
    linkedJobData.data = linkedJob([])
    render(
      <ExportPanel
        workspaceId="ws"
        job={job({ translationJobId: null, status: 'PROCESSING' })}
      />,
    )

    expect((screen.getByTestId('export-quick-download-srt') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('export-video-row'))
    expect(screen.getByTestId('export-video-detail').textContent).toContain(
      'media:export.needJobCompleteDesc',
    )
  })

  it('subtitle downloads unlock from the TRANSLATE stage without a legacy translationJobId', () => {
    linkedJobData.data = linkedJob([])
    render(<ExportPanel workspaceId="ws" job={job({ translationJobId: null })} />)

    expect((screen.getByTestId('export-quick-download-srt') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('export-quick-download-vtt') as HTMLButtonElement).disabled).toBe(false)
  })
})
