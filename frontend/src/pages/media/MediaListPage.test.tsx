// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MediaJob } from '@/types/media'
import type { DocumentItem } from '@/types/document'
import { exportTransformationJobApi, rerunTransformationStageApi } from '@/api/transformation'
import { JobsTable, MediaListPage } from './MediaListPage'

afterEach(() => cleanup())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'prj-1', name: 'Project 1', sourceLang: 'en' }] }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaJobs: () => ({
    data: [mockJob],
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/useDocuments', () => ({
  useDocuments: () => ({ data: [mockDoc] }),
}))

vi.mock('@/components/media-studio/UploadConsentPanel', () => ({
  UploadConsentPanel: () => <div data-testid="mock-upload-panel">Mock Upload Panel</div>,
}))

vi.mock('@/api/transformation', () => ({
  exportTransformationJobApi: vi.fn().mockResolvedValue({
    downloadUrl: 'https://cdn.example.com/rendered.mp4',
    fileName: 'rendered.mp4',
  }),
  rerunTransformationStageApi: vi.fn().mockResolvedValue({}),
}))

const mockJob: MediaJob = {
  id: '12345678-abcd-ef01-2345-6789abcdef01',
  documentId: 'doc-1',
  rootAssetId: 'asset-1',
  projectId: 'prj-1',
  processingMode: 'HYBRID',
  sourceLanguage: 'en',
  targetLang: 'vi',
  status: 'COMPLETED',
  subtitleMode: 'SOFT_SUB',
  requestedDurationSeconds: null,
  selectedProposalId: null,
  createdAt: new Date().toISOString(),
  stages: [],
}

const mockDoc: DocumentItem = {
  id: 'doc-1',
  projectId: 'prj-1',
  name: 'my_awesome_video_presentation_2026.mp4',
  sourceLang: 'en',
  status: 'READY',
  origin: 'VIDEO',
  createdAt: new Date().toISOString(),
}

describe('JobsTable — video title display', () => {
  it('renders video file name from documents with truncate class and tooltip', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[mockJob]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    // The job title should be the video name, NOT "vi (Tiếng Việt)"
    const titleEl = screen.getByText('my_awesome_video_presentation_2026.mp4')
    expect(titleEl).toBeTruthy()
    expect(titleEl.className).toContain('truncate')
    expect(titleEl.getAttribute('title')).toBe('my_awesome_video_presentation_2026.mp4')

    // The target language column still shows the language
    const langBadge = screen.getByText(/Tiếng Việt/)
    expect(langBadge).toBeTruthy()
  })

  it('falls back to Video <id-prefix> when document is not in documents list', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[mockJob]}
          documents={[]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const fallbackTitle = screen.getByText('Video 12345678')
    expect(fallbackTitle).toBeTruthy()
    expect(fallbackTitle.className).toContain('truncate')
  })
})

describe('JobsTable — Stage and Status column styling', () => {
  const jobWithStage: MediaJob = {
    ...mockJob,
    stages: [
      {
        id: 'stg-1',
        stageName: 'RENDER',
        stageOrder: 1,
        status: 'COMPLETED',
        progressPercent: 100,
        errorMessage: null,
        failureReason: null,
        failureDiagnostics: null,
        attemptCount: 1,
        startedAt: null,
        completedAt: null,
      },
    ],
  }

  it('renders stage name without stage badge explanation', () => {
    const { container } = render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[jobWithStage]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    // Stage name should be present
    expect(screen.getByText('media:stages.RENDER')).toBeTruthy()
    // StageBadge explanation (.media-stage-badge) should NOT be present
    expect(container.querySelector('.media-stage-badge')).toBeNull()
  })

  it('renders completed StatusBadge and hides redundant bottom row text', () => {
    const jobWithCompletedPhase: MediaJob = {
      ...mockJob,
      domainPhase: 'COMPLETED',
    }

    const { container } = render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[jobWithCompletedPhase]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    // The StatusBadge is restored with text
    const statusBadge = container.querySelector('.status-badge-completed')
    expect(statusBadge).toBeTruthy()
    expect(statusBadge?.textContent).toContain('status.completed')

    // The redundant bottom row (domainPhase when COMPLETED) should NOT be rendered
    const textTertiary = container.querySelectorAll('.text-\\[11px\\].text-\\[var\\(--color-text-tertiary\\)\\]')
    const phaseEls = Array.from(textTertiary).filter((el) => el.getAttribute('title') === 'COMPLETED')
    expect(phaseEls.length).toBe(0)
  })
})

describe('JobsTable — Action column buttons', () => {
  const failedJob: MediaJob = {
    ...mockJob,
    id: '87654321-abcd-ef01-2345-6789abcdef02',
    status: 'FAILED',
    stages: [
      {
        id: 'stg-render',
        stageName: 'RENDER',
        stageOrder: 1,
        status: 'FAILED',
        progressPercent: 50,
        errorMessage: 'Render timeout',
        failureReason: null,
        failureDiagnostics: null,
        attemptCount: 1,
        startedAt: null,
        completedAt: null,
      },
    ],
  }

  it('renders watch video and download buttons for COMPLETED jobs', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[mockJob]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const watchBtn = screen.getByTestId(`preview-job-${mockJob.id}`)
    expect(watchBtn).toBeTruthy()
    expect(watchBtn.getAttribute('title')).toBe('Xem video')
    expect(screen.getByTestId(`download-job-${mockJob.id}`)).toBeTruthy()
    expect(screen.queryByTestId(`rerun-job-${mockJob.id}`)).toBeNull()
  })

  it('renders rerun button for FAILED jobs', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[failedJob]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId(`rerun-job-${failedJob.id}`)).toBeTruthy()
    expect(screen.queryByTestId(`preview-job-${failedJob.id}`)).toBeNull()
    expect(screen.queryByTestId(`download-job-${failedJob.id}`)).toBeNull()
  })

  it('opens preview modal when clicking preview button', async () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[mockJob]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const previewBtn = screen.getByTestId(`preview-job-${mockJob.id}`)
    fireEvent.click(previewBtn)

    expect(exportTransformationJobApi).toHaveBeenCalledWith('ws', mockJob.id, 'VIDEO')
    const modalEl = await screen.findByRole('dialog')
    expect(modalEl).toBeTruthy()
  })

  it('calls rerun API and onRefresh when clicking rerun button', async () => {
    const onRefresh = vi.fn()
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={[failedJob]}
          documents={[mockDoc]}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={8}
          onPageChange={() => {}}
          onOpen={() => {}}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    )

    const rerunBtn = screen.getByTestId(`rerun-job-${failedJob.id}`)
    fireEvent.click(rerunBtn)

    expect(rerunTransformationStageApi).toHaveBeenCalledWith('ws', failedJob.id, 'RENDER')
    await vi.waitFor(() => {
      expect(onRefresh).toHaveBeenCalled()
    })
  })
})

describe('MediaListPage — URL hash and project param sync', () => {
  it('opens upload panel when hash is #upload and loads project from query', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-1/media?project=prj-1#upload']}>
        <MediaListPage />
      </MemoryRouter>,
    )

    const uploadSection = container.querySelector('[data-section-id="upload"]')
    expect(uploadSection?.getAttribute('data-open')).toBe('true')
  })

  it('defaults to overview panel when hash is #overview or empty', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/w/ws-1/media?project=prj-1#overview']}>
        <MediaListPage />
      </MemoryRouter>,
    )

    const overviewSection = container.querySelector('[data-section-id="overview"]')
    expect(overviewSection?.getAttribute('data-open')).toBe('true')

    const uploadSection = container.querySelector('[data-section-id="upload"]')
    expect(uploadSection?.getAttribute('data-open')).toBe('false')
  })
})
