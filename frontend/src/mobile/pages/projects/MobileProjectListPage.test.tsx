// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileProjectListPage } from './MobileProjectListPage'

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

const mockMutate = vi.fn()
const mockRefetch = vi.fn()

const sampleProjects = [
  {
    id: 'p1',
    name: 'Website Localization',
    sourceLang: 'en',
    mediaCount: 3,
    progressPercent: 65,
  },
  {
    id: 'p2',
    name: 'Mobile App Marketing',
    sourceLang: 'ja',
    mediaCount: 1,
    progressPercent: 20,
  },
]

vi.mock('@/hooks/useProjects', () => ({
  useProjects: vi.fn(() => ({
    data: sampleProjects,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })),
  useCreateProject: vi.fn(() => ({
    mutate: mockMutate,
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

describe('MobileProjectListPage', () => {
  const renderPage = (initialRoute = '/w/ws-123/projects') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/w/:workspaceId/projects" element={<MobileProjectListPage />} />
          <Route path="/w/:workspaceId/media" element={<div data-testid="media-page">Trang Media</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders project cards with name, source language, media count, and progress percent', () => {
    renderPage()

    expect(screen.getByText('Dự án')).toBeInTheDocument()
    expect(screen.getByText('Website Localization')).toBeInTheDocument()
    expect(screen.getByText('Mobile App Marketing')).toBeInTheDocument()

    // Source language badges
    expect(screen.getByText('EN')).toBeInTheDocument()
    expect(screen.getByText('JA')).toBeInTheDocument()

    // Progress percent
    expect(screen.getByText('65%')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()

    // Media count display
    expect(screen.getByText(/3 media/i)).toBeInTheDocument()
    expect(screen.getByText(/1 media/i)).toBeInTheDocument()
  })

  it('filters projects based on search query', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm dự án...')
    expect(searchInput).toBeInTheDocument()

    // Filter for "Website"
    fireEvent.change(searchInput, { target: { value: 'Website' } })
    expect(screen.getByText('Website Localization')).toBeInTheDocument()
    expect(screen.queryByText('Mobile App Marketing')).toBeNull()

    // Filter for "Marketing"
    fireEvent.change(searchInput, { target: { value: 'Marketing' } })
    expect(screen.queryByText('Website Localization')).toBeNull()
    expect(screen.getByText('Mobile App Marketing')).toBeInTheDocument()
  })

  it('shows empty search state when no projects match query and allows clearing search', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm dự án...')
    fireEvent.change(searchInput, { target: { value: 'Nonexistent project' } })

    expect(screen.getByText('Không tìm thấy dự án')).toBeInTheDocument()
    expect(screen.getByText('Không có dự án nào khớp với từ khóa tìm kiếm.')).toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: /Xóa tìm kiếm/i })
    fireEvent.click(clearButton)

    // Should restore projects
    expect(screen.getByText('Website Localization')).toBeInTheDocument()
    expect(screen.getByText('Mobile App Marketing')).toBeInTheDocument()
  })

  it('opens create project sheet when Add button is clicked and submits form', () => {
    renderPage()

    const addBtn = screen.getByLabelText('Tạo dự án mới')
    fireEvent.click(addBtn)

    // Verify BottomSheet open with title
    expect(screen.getByText('Tạo dự án mới')).toBeInTheDocument()

    const nameInput = screen.getByPlaceholderText(/Tên dự án/i)
    fireEvent.change(nameInput, { target: { value: 'Dự án mới 2026' } })

    const submitBtn = screen.getByRole('button', { name: 'Tạo dự án' })
    fireEvent.click(submitBtn)

    expect(mockMutate).toHaveBeenCalledTimes(1)
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Dự án mới 2026',
        sourceLang: 'en',
      }),
      expect.any(Object)
    )
  })

  it('validates required project name before submitting create form', () => {
    renderPage()

    const addBtn = screen.getByLabelText('Tạo dự án mới')
    fireEvent.click(addBtn)

    const submitBtn = screen.getByRole('button', { name: 'Tạo dự án' })
    fireEvent.click(submitBtn)

    // Form shouldn't call mutate with empty name
    expect(mockMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Vui lòng nhập tên dự án')).toBeInTheDocument()
  })

  it('opens action menu when three-dots button is clicked and triggers view action', () => {
    renderPage()

    const actionButtons = screen.getAllByLabelText(/Thao tác dự án/i)
    fireEvent.click(actionButtons[0])

    // Action menu should show project name and actions
    expect(screen.getAllByText('Website Localization').length).toBeGreaterThanOrEqual(1)
    const viewAction = screen.getByText('Xem media / tài liệu')
    expect(viewAction).toBeInTheDocument()

    fireEvent.click(viewAction)
    expect(screen.getByTestId('media-page')).toBeInTheDocument()
  })

  it('renders empty state when there are no projects', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    vi.mocked(useProjects).mockReturnValueOnce({
      data: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Chưa có dự án nào')).toBeInTheDocument()
    expect(screen.getByText('Bắt đầu tổ chức các tệp dịch thuật bằng cách tạo dự án đầu tiên.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo dự án' })).toBeInTheDocument()
  })

  it('renders loading state when projects are loading', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    vi.mocked(useProjects).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Đang tải danh sách dự án...')).toBeInTheDocument()
  })

  it('renders error state and retries on click', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    vi.mocked(useProjects).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to fetch'),
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Không thể tải danh sách dự án')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' })
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })
})
