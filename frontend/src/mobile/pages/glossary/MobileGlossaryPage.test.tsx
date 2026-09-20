// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileGlossaryPage } from './MobileGlossaryPage'

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

const mockRefetchGlossaries = vi.fn()
const mockRefetchTerms = vi.fn()
const mockAddTermsMutate = vi.fn()
const mockDeleteTermMutate = vi.fn()

const sampleGlossaries = [
  {
    id: 'g1',
    name: 'Công nghệ thông tin',
    description: 'Thuật ngữ CNTT và phần mềm',
    termCount: 2,
    updatedAt: '2026-05-10T10:00:00Z',
  },
  {
    id: 'g2',
    name: 'Kinh tế tài chính',
    description: 'Thuật ngữ tài chính kế toán',
    termCount: 1,
    updatedAt: '2026-05-11T12:00:00Z',
  },
]

const sampleTermsG1 = [
  {
    id: 't1',
    sourceTerm: 'Artificial Intelligence',
    targetTerm: 'Trí tuệ nhân tạo',
    caseSensitive: false,
    partOfSpeech: 'noun',
    note: 'Công nghệ cao',
    updatedAt: '2026-05-10T10:00:00Z',
  },
  {
    id: 't2',
    sourceTerm: 'Machine Learning',
    targetTerm: 'Học máy',
    caseSensitive: false,
    partOfSpeech: 'noun',
    note: 'Lĩnh vực con của AI',
    updatedAt: '2026-05-10T10:00:00Z',
  },
]

const sampleTermsG2 = [
  {
    id: 't3',
    sourceTerm: 'Cash Flow',
    targetTerm: 'Dòng tiền',
    caseSensitive: false,
    partOfSpeech: 'noun',
    note: 'Báo cáo lưu chuyển tiền tệ',
    updatedAt: '2026-05-11T12:00:00Z',
  },
]

vi.mock('@/hooks/useGlossary', () => ({
  useGlossaries: vi.fn(() => ({
    data: sampleGlossaries,
    isLoading: false,
    error: null,
    refetch: mockRefetchGlossaries,
  })),
  useGlossaryTerms: vi.fn((_ws: string, glossaryId?: string) => ({
    data: glossaryId === 'g2' ? sampleTermsG2 : sampleTermsG1,
    isLoading: false,
    error: null,
    refetch: mockRefetchTerms,
  })),
  useAddTerms: vi.fn(() => ({
    mutate: mockAddTermsMutate,
    isPending: false,
  })),
  useDeleteTerm: vi.fn(() => ({
    mutate: mockDeleteTermMutate,
    isPending: false,
  })),
  useCreateGlossary: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}))

describe('MobileGlossaryPage', () => {
  const renderPage = (initialRoute = '/w/ws-test/glossary') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/w/:workspaceId/glossary" element={<MobileGlossaryPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders title and glossary term pair cards', () => {
    renderPage()

    expect(screen.getByText('Từ điển thuật ngữ')).toBeInTheDocument()
    expect(screen.getByText('Artificial Intelligence')).toBeInTheDocument()
    expect(screen.getByText('Trí tuệ nhân tạo')).toBeInTheDocument()
    expect(screen.getByText('Machine Learning')).toBeInTheDocument()
    expect(screen.getByText('Học máy')).toBeInTheDocument()
  })

  it('renders note or context badge for terms', () => {
    renderPage()

    expect(screen.getByText('Công nghệ cao')).toBeInTheDocument()
    expect(screen.getByText('Lĩnh vực con của AI')).toBeInTheDocument()
  })

  it('allows selecting and switching glossary when multiple exist', async () => {
    renderPage()

    // First glossary terms are shown
    expect(screen.getByText('Artificial Intelligence')).toBeInTheDocument()

    // Switch to second glossary using select or pill
    const select = screen.getByLabelText('Chọn bộ thuật ngữ')
    expect(select).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'g2' } })

    // Now g2 term is shown
    expect(screen.getByText('Cash Flow')).toBeInTheDocument()
    expect(screen.getByText('Dòng tiền')).toBeInTheDocument()
  })

  it('filters terms based on search query', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm thuật ngữ...')
    expect(searchInput).toBeInTheDocument()

    // Search for "Machine"
    fireEvent.change(searchInput, { target: { value: 'Machine' } })
    expect(screen.getByText('Machine Learning')).toBeInTheDocument()
    expect(screen.queryByText('Artificial Intelligence')).toBeNull()

    // Search for Vietnamese target "Trí tuệ"
    fireEvent.change(searchInput, { target: { value: 'Trí tuệ' } })
    expect(screen.getByText('Artificial Intelligence')).toBeInTheDocument()
    expect(screen.queryByText('Machine Learning')).toBeNull()
  })

  it('shows empty search state when no terms match and allows clearing', () => {
    renderPage()

    const searchInput = screen.getByPlaceholderText('Tìm thuật ngữ...')
    fireEvent.change(searchInput, { target: { value: 'Nonexistent term xyz' } })

    expect(screen.getByText('Không tìm thấy thuật ngữ')).toBeInTheDocument()
    expect(screen.getByText('Không có thuật ngữ nào khớp với từ khóa tìm kiếm.')).toBeInTheDocument()

    const clearButton = screen.getByRole('button', { name: /Xóa tìm kiếm/i })
    fireEvent.click(clearButton)

    expect(screen.getByText('Artificial Intelligence')).toBeInTheDocument()
  })

  it('renders loading state when terms are loading', async () => {
    const { useGlossaryTerms } = await import('@/hooks/useGlossary')
    vi.mocked(useGlossaryTerms).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetchTerms,
    } as any)

    renderPage()

    expect(screen.getByText('Đang tải thuật ngữ...')).toBeInTheDocument()
  })

  it('renders error state and retries on click', async () => {
    const { useGlossaryTerms } = await import('@/hooks/useGlossary')
    vi.mocked(useGlossaryTerms).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
      refetch: mockRefetchTerms,
    } as any)

    renderPage()

    expect(screen.getByText('Không thể tải thuật ngữ')).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' })
    fireEvent.click(retryBtn)
    expect(mockRefetchTerms).toHaveBeenCalledTimes(1)
  })

  it('renders empty state when glossary has no terms', async () => {
    const { useGlossaryTerms } = await import('@/hooks/useGlossary')
    vi.mocked(useGlossaryTerms).mockReturnValueOnce({
      data: [],
      isLoading: false,
      error: null,
      refetch: mockRefetchTerms,
    } as any)

    renderPage()

    expect(screen.getByText('Chưa có thuật ngữ nào')).toBeInTheDocument()
    expect(screen.getByText('Thêm cặp từ ngữ chuyên ngành để chuẩn hóa bản dịch tự động.')).toBeInTheDocument()
  })

  it('opens BottomSheet and adds a new term successfully', () => {
    renderPage()

    // Open add sheet
    const addBtn = screen.getByRole('button', { name: /Thêm từ/i })
    fireEvent.click(addBtn)

    expect(screen.getByText('Thêm thuật ngữ mới')).toBeInTheDocument()

    const sourceInput = screen.getByPlaceholderText('VD: machine learning')
    const targetInput = screen.getByPlaceholderText('VD: học máy')
    const contextInput = screen.getByPlaceholderText('VD: Thuật ngữ CNTT')

    fireEvent.change(sourceInput, { target: { value: 'Deep Learning' } })
    fireEvent.change(targetInput, { target: { value: 'Học sâu' } })
    fireEvent.change(contextInput, { target: { value: 'Mạng nơ-ron' } })

    const saveBtn = screen.getByRole('button', { name: 'Lưu thuật ngữ' })
    fireEvent.click(saveBtn)

    expect(mockAddTermsMutate).toHaveBeenCalledWith([
      {
        sourceTerm: 'Deep Learning',
        targetTerm: 'Học sâu',
        note: 'Mạng nơ-ron',
      },
    ])
  })

  it('validates required fields before submitting new term', () => {
    renderPage()

    const addBtn = screen.getByRole('button', { name: /Thêm từ/i })
    fireEvent.click(addBtn)

    const saveBtn = screen.getByRole('button', { name: 'Lưu thuật ngữ' })
    fireEvent.click(saveBtn)

    expect(mockAddTermsMutate).not.toHaveBeenCalled()
    expect(screen.getByText('Vui lòng nhập đầy đủ từ gốc và từ dịch')).toBeInTheDocument()
  })

  it('deletes a term when delete button is clicked', () => {
    renderPage()

    const deleteBtns = screen.getAllByRole('button', { name: /Xóa thuật ngữ/i })
    expect(deleteBtns.length).toBeGreaterThan(0)

    fireEvent.click(deleteBtns[0])

    expect(mockDeleteTermMutate).toHaveBeenCalledWith('t1')
  })

  it('supports legacy hook return shape with terms array and source/target fields', async () => {
    const mockAddTermLegacy = vi.fn()
    const mockDeleteTermLegacy = vi.fn()

    const { useGlossaries } = await import('@/hooks/useGlossary')
    vi.mocked(useGlossaries).mockReturnValue({
      terms: [
        { id: 't-legacy', source: 'Legacy Source', target: 'Bản dịch cũ', context: 'Ghi chú cũ' },
      ],
      isLoading: false,
      addTerm: mockAddTermLegacy,
      deleteTerm: mockDeleteTermLegacy,
    } as any)

    renderPage()

    expect(screen.getByText('Legacy Source')).toBeInTheDocument()
    expect(screen.getByText('Bản dịch cũ')).toBeInTheDocument()
    expect(screen.getByText('Ghi chú cũ')).toBeInTheDocument()

    // Test legacy delete
    const deleteBtn = screen.getByRole('button', { name: /Xóa thuật ngữ Legacy Source/i })
    fireEvent.click(deleteBtn)
    expect(mockDeleteTermLegacy).toHaveBeenCalledWith('t-legacy')

    // Test legacy add
    const addBtn = screen.getByRole('button', { name: /Thêm từ/i })
    fireEvent.click(addBtn)

    const sourceInput = screen.getByPlaceholderText('VD: machine learning')
    const targetInput = screen.getByPlaceholderText('VD: học máy')
    fireEvent.change(sourceInput, { target: { value: 'Neural Network' } })
    fireEvent.change(targetInput, { target: { value: 'Mạng nơ-ron' } })

    const saveBtn = screen.getByRole('button', { name: 'Lưu thuật ngữ' })
    fireEvent.click(saveBtn)

    expect(mockAddTermLegacy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'Neural Network',
        target: 'Mạng nơ-ron',
      })
    )
  })
})
