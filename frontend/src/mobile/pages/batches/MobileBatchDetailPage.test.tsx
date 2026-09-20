// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileBatchDetailPage } from './MobileBatchDetailPage'

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
const mockRetryMutate = vi.fn()

const sampleBatchDetail = {
  id: 'b1',
  projectId: 'proj-1',
  name: 'Chi tiết lô tài liệu tháng 5',
  status: 'PARTIALLY_FAILED',
  totalDocuments: 3,
  completedDocuments: 2,
  failedDocuments: 1,
  totalSizeBytes: 1024,
  createdAt: '2026-05-10T10:00:00Z',
  updatedAt: '2026-05-10T11:00:00Z',
  documents: [
    {
      documentId: 'doc-1',
      name: 'Báo cáo tài chính.pdf',
      sourceLang: 'en',
      origin: 'upload',
      status: 'COMPLETED',
      jobs: [{ jobId: 'j-1', targetLang: 'vi', status: 'COMPLETED' }],
    },
    {
      documentId: 'doc-2',
      name: 'Hợp đồng thương mại.docx',
      sourceLang: 'en',
      origin: 'upload',
      status: 'FAILED',
      jobs: [{ jobId: 'j-2', targetLang: 'vi', status: 'FAILED' }],
    },
    {
      documentId: 'doc-3',
      name: 'Hướng dẫn sử dụng.txt',
      sourceLang: 'en',
      origin: 'upload',
      status: 'COMPLETED',
      jobs: [{ jobId: 'j-3', targetLang: 'vi', status: 'COMPLETED' }],
    },
  ],
}

vi.mock('@/hooks/useBatches', () => ({
  useBatchDetail: vi.fn(() => ({
    data: sampleBatchDetail,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  })),
  useRetryBatchDocument: vi.fn(() => ({
    mutate: mockRetryMutate,
    isPending: false,
    variables: undefined,
  })),
}))

describe('MobileBatchDetailPage', () => {
  const renderPage = (initialRoute = '/w/ws-123/batches/b1') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/w/:workspaceId/batches/:batchId" element={<MobileBatchDetailPage />} />
          <Route path="/w/:workspaceId/batches" element={<div data-testid="batch-list-page">Danh sách lô</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders batch detail with summary card and document items', () => {
    renderPage()

    // Title and back button
    expect(screen.getByText('Chi tiết lô tài liệu tháng 5')).toBeInTheDocument()
    const backBtn = screen.getByLabelText(/Quay lại/i)
    expect(backBtn).toBeInTheDocument()

    // Summary Card info
    expect(screen.getByText('PARTIALLY_FAILED')).toBeInTheDocument()
    // Progress: 2/3 completed = 67%
    expect(screen.getByText('67%')).toBeInTheDocument()

    // Partial failure alert banner
    expect(screen.getByText(/Thành công một phần/i)).toBeInTheDocument()

    // Document items
    expect(screen.getByText('Báo cáo tài chính.pdf')).toBeInTheDocument()
    expect(screen.getByText('Hợp đồng thương mại.docx')).toBeInTheDocument()
    expect(screen.getByText('Hướng dẫn sử dụng.txt')).toBeInTheDocument()
  })

  it('shows retry button on failed document and invokes retry mutation on click', () => {
    renderPage()

    const retryBtn = screen.getByRole('button', { name: /Thử lại/i })
    expect(retryBtn).toBeInTheDocument()

    fireEvent.click(retryBtn)
    expect(mockRetryMutate).toHaveBeenCalledWith('doc-2')
  })

  it('navigates back to batches list when back button is clicked', () => {
    renderPage()

    const backBtn = screen.getByLabelText(/Quay lại/i)
    fireEvent.click(backBtn)

    expect(screen.getByTestId('batch-list-page')).toBeInTheDocument()
  })

  it('renders loading state when batch detail is loading', async () => {
    const { useBatchDetail } = await import('@/hooks/useBatches')
    vi.mocked(useBatchDetail).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Đang tải chi tiết lô...')).toBeInTheDocument()
  })

  it('renders error state and retries on click', async () => {
    const { useBatchDetail } = await import('@/hooks/useBatches')
    vi.mocked(useBatchDetail).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load batch'),
      refetch: mockRefetch,
    } as any)

    renderPage()

    expect(screen.getByText('Không thể tải chi tiết lô')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' })
    fireEvent.click(retryBtn)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('supports legacy hook return shape with batch and items array', async () => {
    const mockRerunItem = vi.fn()
    const { useBatchDetail } = await import('@/hooks/useBatches')
    vi.mocked(useBatchDetail).mockReturnValueOnce({
      batch: {
        id: 'legacy-b',
        name: 'Legacy Batch Detail',
        status: 'PROCESSING',
        progress: 50,
      },
      items: [
        { id: 'item-1', name: 'File1.txt', status: 'FAILED' },
      ],
      isLoading: false,
      rerunItem: mockRerunItem,
    } as any)

    renderPage()

    expect(screen.getByText('Legacy Batch Detail')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('File1.txt')).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /Thử lại/i })
    fireEvent.click(retryBtn)
    expect(mockRerunItem).toHaveBeenCalledWith('item-1')
  })
})
