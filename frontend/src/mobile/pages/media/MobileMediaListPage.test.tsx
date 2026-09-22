// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileMediaListPage } from './MobileMediaListPage'

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

const sampleJobs = [
  {
    id: 'job-123',
    title: 'Product Launch Video',
    fileName: 'product_launch_2026.mp4',
    recipeId: 'localization.full',
    keepOriginalAudio: false,
    aspectRatio: '16:9',
    status: 'COMPLETED',
    duration: '02:45',
    progress: 100,
    targetLang: 'vi',
  },
  {
    id: 'job-456',
    title: 'Interview Audio',
    fileName: 'podcast_interview_hq.mp4',
    recipeId: 'summary.generative',
    keepOriginalAudio: true,
    aspectRatio: '9:16',
    status: 'PROCESSING',
    duration: '05:10',
    progress: 45,
    targetLang: 'en',
  },
  {
    id: 'job-789',
    title: 'Failed Presentation',
    fileName: 'quarterly_financial_report.mp4',
    recipeId: 'localization.full',
    keepOriginalAudio: false,
    aspectRatio: '16:9',
    status: 'FAILED',
    duration: '01:15',
    progress: 10,
    targetLang: 'ja',
  },
]

vi.mock('@/hooks/useProjects', () => ({
  useProjects: vi.fn((_workspaceId?: string) => ({
    data: sampleProjects,
    isLoading: false,
    error: null,
  })),
}))

const mockRefetch = vi.fn()

vi.mock('@/hooks/useMedia', () => ({
  useMediaJobs: vi.fn((_workspaceId?: string, _projectId?: string) => ({
    jobs: sampleJobs,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

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

  it('renders media card with direct link to Media Studio', () => {
    render(
      <MemoryRouter>
        <MobileMediaListPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Media Hub')).toBeInTheDocument()
    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
    expect(screen.getByText('02:45')).toBeInTheDocument()
  })

  it('navigates to media studio when clicking a media item card', () => {
    renderPage()

    const itemLink = screen.getByText('Product Launch Video').closest('a')
    expect(itemLink).toBeInTheDocument()
    expect(itemLink?.getAttribute('href')).toBe('/w/ws-123/media/jobs/job-123')

    fireEvent.click(screen.getByText('Product Launch Video'))
    expect(screen.getByTestId('media-studio-page')).toBeInTheDocument()
  })

  it('renders presets link and navigates to presets page on click', () => {
    renderPage()

    const presetsLink = screen.getByRole('link', { name: 'Presets' })
    expect(presetsLink).toBeInTheDocument()
    expect(presetsLink.getAttribute('href')).toBe('/w/ws-123/media/presets')

    fireEvent.click(presetsLink)
    expect(screen.getByTestId('media-presets-page')).toBeInTheDocument()
  })

  it('renders status filter tabs and filters items by status', () => {
    renderPage()

    expect(screen.getByRole('button', { name: 'Tất cả' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đang xử lý' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hoàn thành' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thất bại' })).toBeInTheDocument()

    // Initially all 3 jobs are visible
    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
    expect(screen.getByText('Interview Audio')).toBeInTheDocument()
    expect(screen.getByText('Failed Presentation')).toBeInTheDocument()

    // Filter by Hoàn thành
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }))
    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
    expect(screen.queryByText('Interview Audio')).toBeNull()
    expect(screen.queryByText('Failed Presentation')).toBeNull()

    // Filter by Đang xử lý
    fireEvent.click(screen.getByRole('button', { name: 'Đang xử lý' }))
    expect(screen.queryByText('Product Launch Video')).toBeNull()
    expect(screen.getByText('Interview Audio')).toBeInTheDocument()
    expect(screen.queryByText('Failed Presentation')).toBeNull()

    // Filter by Thất bại
    fireEvent.click(screen.getByRole('button', { name: 'Thất bại' }))
    expect(screen.queryByText('Product Launch Video')).toBeNull()
    expect(screen.queryByText('Interview Audio')).toBeNull()
    expect(screen.getByText('Failed Presentation')).toBeInTheDocument()

    // Return to Tất cả
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }))
    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
    expect(screen.getByText('Interview Audio')).toBeInTheDocument()
    expect(screen.getByText('Failed Presentation')).toBeInTheDocument()
  })

  it('filters media items using search input', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm video/audio...')
    expect(searchInput).toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: 'Interview' } })
    expect(screen.getByText('Interview Audio')).toBeInTheDocument()
    expect(screen.queryByText('Product Launch Video')).toBeNull()
    expect(screen.queryByText('Failed Presentation')).toBeNull()
  })

  it('shows empty search state when no items match and clears filter on action', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm video/audio...')
    fireEvent.change(searchInput, { target: { value: 'Nonexistent video' } })

    expect(screen.getByText('Không tìm thấy tệp media')).toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: /Xóa bộ lọc/i })
    fireEvent.click(clearButton)

    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
    expect(screen.getByText('Interview Audio')).toBeInTheDocument()
  })

  it('renders progress bar for PROCESSING job', () => {
    renderPage()

    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getAllByText('Đang xử lý').length).toBeGreaterThanOrEqual(2)
  })

  it('renders loading state when media jobs are loading', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')
    vi.mocked(useMediaJobs).mockReturnValueOnce({
      jobs: [],
      isLoading: true,
      error: null,
    } as any)

    renderPage()
    expect(screen.getByText('Đang tải danh sách media...')).toBeInTheDocument()
  })

  it('renders empty state when there are no media items', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')
    vi.mocked(useMediaJobs).mockReturnValueOnce({
      jobs: [],
      isLoading: false,
      error: null,
    } as any)

    renderPage()
    expect(screen.getByText('Chưa có tệp Media nào')).toBeInTheDocument()
    expect(screen.getByText('Tải lên tệp video hoặc audio để bắt đầu quy trình phụ đề và lồng tiếng AI.')).toBeInTheDocument()
  })

  it('renders error state and retries on button click', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')
    vi.mocked(useMediaJobs).mockReturnValueOnce({
      jobs: [],
      isLoading: false,
      error: new Error('Failed to load media jobs'),
      refetch: mockRefetch,
    } as any)

    renderPage()
    expect(screen.getByText('Không thể tải danh sách media')).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /Thử lại/i })
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('uses projectId from URL searchParams or defaults to first project id', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')

    // 1. Without search param -> defaults to sampleProjects[0].id ('proj-1')
    renderPage('/w/ws-123/media')
    expect(useMediaJobs).toHaveBeenCalledWith('ws-123', 'proj-1')

    // 2. With search param ?projectId=proj-custom -> uses 'proj-custom'
    cleanup()
    renderPage('/w/ws-123/media?projectId=proj-custom')
    expect(useMediaJobs).toHaveBeenCalledWith('ws-123', 'proj-custom')
  })

  it('supports TanStack query return shape with data array instead of jobs', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')
    vi.mocked(useMediaJobs).mockReturnValueOnce({
      data: [
        {
          id: 'job-tanstack',
          fileName: 'TanStack Video.mp4',
          status: 'COMPLETED',
          duration: '03:30',
        },
      ],
      isLoading: false,
      error: null,
    } as any)

    renderPage()
    expect(screen.getByText('TanStack Video.mp4')).toBeInTheDocument()
    expect(screen.getByText('03:30')).toBeInTheDocument()
  })

  it('supports direct array return shape and formats numeric durationSeconds', async () => {
    const { useMediaJobs } = await import('@/hooks/useMedia')
    vi.mocked(useMediaJobs).mockReturnValueOnce([
      {
        id: 'job-direct-array',
        title: 'Direct Array Video',
        status: 'COMPLETED',
        durationSeconds: 150, // 02:30
        targetLang: 'ko',
        recipeId: 'localization.full',
      },
    ] as any)

    renderPage()
    expect(screen.getByText('Direct Array Video')).toBeInTheDocument()
    expect(screen.getByText('02:30')).toBeInTheDocument()
    expect(screen.getByText('KO')).toBeInTheDocument()
    expect(screen.getByText('localization.full')).toBeInTheDocument()
  })

  it('switches active project when clicking project button in selector', () => {
    renderPage()

    const projectBetaBtn = screen.getByRole('button', { name: 'Dự án Beta' })
    expect(projectBetaBtn).toBeInTheDocument()

    fireEvent.click(projectBetaBtn)
    // The button should now have active styles
    expect(projectBetaBtn.className).toContain('border-primary')
  })

  it('handles empty projects list gracefully', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    vi.mocked(useProjects).mockReturnValueOnce({
      data: [],
      isLoading: false,
      error: null,
    } as any)

    renderPage()
    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
  })
})

