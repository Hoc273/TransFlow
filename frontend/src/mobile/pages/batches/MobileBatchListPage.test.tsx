// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileBatchListPage } from './MobileBatchListPage'

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

const mockRefetch = vi.fn()

const sampleBatches = [
  {
    id: 'b1',
    name: 'Batch Docs May',
    status: 'PROCESSING',
    progress: 45,
    totalFiles: 10,
    completedFiles: 4,
    totalDocuments: 10,
    completedDocuments: 4,
    failedDocuments: 0,
    createdAt: '2026-05-10T10:00:00Z',
  },
  {
    id: 'b2',
    name: 'Q3 Financial Reports',
    status: 'COMPLETED',
    progress: 100,
    totalFiles: 5,
    completedFiles: 5,
    totalDocuments: 5,
    completedDocuments: 5,
    failedDocuments: 0,
    createdAt: '2026-05-11T12:00:00Z',
  },
]

vi.mock('@/hooks/useBatches', () => ({
  useBatches: vi.fn(() => ({
    data: sampleBatches,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

describe('MobileBatchListPage', () => {
  const renderPage = (initialRoute = '/w/ws-123/batches') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/w/:workspaceId/batches" element={<MobileBatchListPage />} />
          <Route path="/w/:workspaceId/batches/:batchId" element={<div data-testid="detail-page">Chi tiết lô</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders batch list item with progress and status', () => {
    renderPage()

    expect(screen.getByText('Lô xử lý')).toBeInTheDocument()
    expect(screen.getByText('Batch Docs May')).toBeInTheDocument()
    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getByText('PROCESSING')).toBeInTheDocument()
    expect(screen.getByText('Q3 Financial Reports')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()
  })

  it('filters batches based on search query', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm lô xử lý...')
    expect(searchInput).toBeInTheDocument()

    // Filter for "May"
    fireEvent.change(searchInput, { target: { value: 'May' } })
    expect(screen.getByText('Batch Docs May')).toBeInTheDocument()
    expect(screen.queryByText('Q3 Financial Reports')).toBeNull()

    // Filter for "Financial"
    fireEvent.change(searchInput, { target: { value: 'Financial' } })
    expect(screen.queryByText('Batch Docs May')).toBeNull()
    expect(screen.getByText('Q3 Financial Reports')).toBeInTheDocument()
  })

  it('shows empty search state when no batches match and allows clearing', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm kiếm lô xử lý...')
    fireEvent.change(searchInput, { target: { value: 'Nonexistent batch' } })

    expect(screen.getByText('Không tìm thấy lô xử lý')).toBeInTheDocument()
    expect(screen.getByText('Không có lô xử lý nào khớp với từ khóa tìm kiếm.')).toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: /Xóa tìm kiếm/i })
    fireEvent.click(clearButton)

    // Batches should be restored
    expect(screen.getByText('Batch Docs May')).toBeInTheDocument()
    expect(screen.getByText('Q3 Financial Reports')).toBeInTheDocument()
  })

  it('renders empty state when there are no batches in workspace', async () => {
    const { useBatches } = await import('@/hooks/useBatches')
    vi.mocked(useBatches).mockReturnValueOnce({
      data: [],
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Chưa có lô xử lý nào')).toBeInTheDocument()
    expect(screen.getByText('Các tệp được xử lý đồng thời sẽ hiển thị tại đây.')).toBeInTheDocument()
  })

  it('renders loading state when batches are loading', async () => {
    const { useBatches } = await import('@/hooks/useBatches')
    vi.mocked(useBatches).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Đang tải lô xử lý...')).toBeInTheDocument()
  })

  it('renders error state and retries on click', async () => {
    const { useBatches } = await import('@/hooks/useBatches')
    vi.mocked(useBatches).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Không thể tải danh sách lô xử lý')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' })
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('supports legacy hook return shape with batches array', async () => {
    const { useBatches } = await import('@/hooks/useBatches')
    vi.mocked(useBatches).mockReturnValueOnce({
      batches: [
        { id: 'b-legacy', name: 'Legacy Batch', status: 'PENDING', progress: 10, totalFiles: 8, completedFiles: 1 },
      ],
      isLoading: false,
    } as any)

    renderPage()

    expect(screen.getByText('Legacy Batch')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
  })
})
