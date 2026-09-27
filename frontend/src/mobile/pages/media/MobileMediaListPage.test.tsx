// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileMediaListPage } from './MobileMediaListPage'
import i18n from '@/i18n'

interface CustomMatchers<R = unknown> {
  toBeInTheDocument(): R
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toBeInTheDocument(received) {
    const pass = received !== null && received !== undefined
    return {
      pass,
      message: () => `expected element to ${pass ? 'not ' : ''}be in the document`,
    }
  },
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const sampleProjects = [
  { id: 'proj-1', name: 'Dự án Alpha' },
  { id: 'proj-2', name: 'Dự án Beta' },
]

const stage = (stageName: string, status: string) => ({ stageName, status })

const sampleJobs = [
  {
    id: 'job-123',
    rootAssetId: 'asset-1',
    recipeId: 'localization.full',
    status: 'COMPLETED',
    targetLang: 'vi',
    requestedDurationSeconds: null,
    stages: [stage('STT', 'COMPLETED')],
  },
  {
    id: 'job-456',
    rootAssetId: 'asset-2',
    recipeId: 'summary.generative',
    status: 'PROCESSING',
    targetLang: 'en',
    requestedDurationSeconds: null,
    stages: [stage('EXTRACT_AUDIO', 'COMPLETED'), stage('STT', 'PENDING')],
  },
  {
    id: 'job-789',
    rootAssetId: 'asset-3',
    recipeId: 'localization.full',
    status: 'FAILED',
    targetLang: 'ja',
    requestedDurationSeconds: null,
    stages: [stage('STT', 'FAILED')],
  },
]

const sampleAssets = [
  { id: 'asset-1', fileName: 'Product Launch Video.mp4', durationMs: 165_000 },
  { id: 'asset-2', fileName: 'Interview Audio.mp4', durationMs: 310_000 },
  { id: 'asset-3', fileName: 'Failed Presentation.mp4', durationMs: 75_000 },
]

vi.mock('@/hooks/useProjects', () => ({
  useProjects: vi.fn(() => ({ data: sampleProjects, isLoading: false, error: null })),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: vi.fn(() => true),
}))

vi.mock('@/components/media-studio/UploadConsentPanel', () => ({
  UploadConsentPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="upload-panel">{projectId}</div>
  ),
}))

const mockRefetch = vi.fn()

vi.mock('@/hooks/useMedia', () => ({
  useMediaJobs: vi.fn(() => ({
    data: sampleJobs,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mockRefetch,
  })),
  useProjectMediaAssets: vi.fn(() => ({ data: sampleAssets })),
}))

beforeAll(async () => {
  await i18n.changeLanguage('vi')
})

describe('MobileMediaListPage', () => {
  const renderPage = (initialRoute = '/w/ws-123/media') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/w/:workspaceId/media" element={<MobileMediaListPage />} />
          <Route path="/w/:workspaceId/media/jobs/:jobId" element={<div data-testid="media-studio-page">Media Studio</div>} />
          <Route path="/w/:workspaceId/media/presets" element={<div data-testid="media-presets-page">Media Presets</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders job cards titled by their root asset file name and duration', () => {
    renderPage()
    expect(screen.getByText('Media Hub')).toBeInTheDocument()
    expect(screen.getByText('Product Launch Video.mp4')).toBeInTheDocument()
    expect(screen.getByText('02:45')).toBeInTheDocument()
    expect(screen.getByText('VI')).toBeInTheDocument()
  })

  it('falls back to a short job id title when the asset is unknown', async () => {
    const { useProjectMediaAssets } = await import('@/hooks/useMedia')
    vi.mocked(useProjectMediaAssets).mockReturnValue({ data: [] } as any)
    renderPage()
    expect(screen.getByText('Tệp media job-123')).toBeInTheDocument()
    vi.mocked(useProjectMediaAssets).mockReturnValue({ data: sampleAssets } as any)
  })

  it('navigates to media studio when clicking a media item card', () => {
    renderPage()

    const itemLink = screen.getByText('Product Launch Video.mp4').closest('a')
    expect(itemLink?.getAttribute('href')).toBe('/w/ws-123/media/jobs/job-123')

    fireEvent.click(screen.getByText('Product Launch Video.mp4'))
    expect(screen.getByTestId('media-studio-page')).toBeInTheDocument()
  })

  it('renders presets link and navigates to presets page on click', () => {
    renderPage()

    const presetsLink = screen.getByRole('link', { name: 'Presets' })
    expect(presetsLink.getAttribute('href')).toBe('/w/ws-123/media/presets')

    fireEvent.click(presetsLink)
    expect(screen.getByTestId('media-presets-page')).toBeInTheDocument()
  })

  it('filters items by status', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }))
    expect(screen.getByText('Product Launch Video.mp4')).toBeInTheDocument()
    expect(screen.queryByText('Interview Audio.mp4')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Đang xử lý' }))
    expect(screen.queryByText('Product Launch Video.mp4')).toBeNull()
    expect(screen.getByText('Interview Audio.mp4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Thất bại' }))
    expect(screen.getByText('Failed Presentation.mp4')).toBeInTheDocument()
    expect(screen.queryByText('Interview Audio.mp4')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }))
    expect(screen.getByText('Product Launch Video.mp4')).toBeInTheDocument()
    expect(screen.getByText('Interview Audio.mp4')).toBeInTheDocument()
    expect(screen.getByText('Failed Presentation.mp4')).toBeInTheDocument()
  })

  it('filters media items using search input and clears the filter', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm video/audio...')
    fireEvent.change(searchInput, { target: { value: 'Interview' } })
    expect(screen.getByText('Interview Audio.mp4')).toBeInTheDocument()
    expect(screen.queryByText('Product Launch Video.mp4')).toBeNull()

    fireEvent.change(searchInput, { target: { value: 'Nonexistent video' } })
    expect(screen.getByText('Không tìm thấy tệp media')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Xóa bộ lọc/i }))
    expect(screen.getByText('Product Launch Video.mp4')).toBeInTheDocument()
  })

  it('renders stage-based progress for a PROCESSING job', () => {
    renderPage()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('renders loading, empty and error states', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')

    vi.mocked(useMediaJobs).mockReturnValueOnce({ data: [], isLoading: true, error: null } as any)
    renderPage()
    expect(screen.getByText('Đang tải danh sách media...')).toBeInTheDocument()
    cleanup()

    vi.mocked(useMediaJobs).mockReturnValueOnce({ data: [], isLoading: false, error: null } as any)
    renderPage()
    expect(screen.getByText('Chưa có tệp Media nào')).toBeInTheDocument()
    cleanup()

    vi.mocked(useMediaJobs).mockReturnValueOnce({
      data: [],
      isLoading: false,
      error: new Error('Failed to load media jobs'),
      refetch: mockRefetch,
    } as any)
    renderPage()
    expect(screen.getByText('Không thể tải danh sách media')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^Thử lại$/i }).at(-1)!)
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('uses ?project= / ?projectId= or defaults to the first project', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')

    renderPage('/w/ws-123/media')
    expect(useMediaJobs).toHaveBeenCalledWith('ws-123', 'proj-1')
    cleanup()

    renderPage('/w/ws-123/media?projectId=proj-custom')
    expect(useMediaJobs).toHaveBeenCalledWith('ws-123', 'proj-custom')
    cleanup()

    renderPage('/w/ws-123/media?project=proj-2')
    expect(useMediaJobs).toHaveBeenCalledWith('ws-123', 'proj-2')
  })

  it('switches active project when clicking project button in selector', () => {
    renderPage()
    const projectBetaBtn = screen.getByRole('button', { name: 'Dự án Beta' })
    fireEvent.click(projectBetaBtn)
    expect(projectBetaBtn.className).toContain('border-primary')
  })

  it('opens the create-job upload panel for the selected project', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('mobile-media-new-job'))
    expect(screen.getByTestId('upload-panel').textContent).toBe('proj-1')
    fireEvent.click(screen.getByRole('button', { name: /Quay lại danh sách/i }))
    expect(screen.queryByTestId('upload-panel')).toBeNull()
  })

  it('hides the create-job button without upload permission', async () => {
    const { usePermission } = await import('@/hooks/usePermission')
    vi.mocked(usePermission).mockReturnValue(false)
    renderPage()
    expect(screen.queryByTestId('mobile-media-new-job')).toBeNull()
    vi.mocked(usePermission).mockReturnValue(true)
  })

  it('shows the no-project state when the workspace has no project', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    vi.mocked(useProjects).mockReturnValueOnce({ data: [], isLoading: false, error: null } as any)
    renderPage()
    expect(screen.getByText('Chưa chọn dự án')).toBeInTheDocument()
  })
})
