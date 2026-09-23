// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileDashboardPage } from './MobileDashboardPage'

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

afterEach(() => cleanup())

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      currentWorkspace: { id: 'ws-123', name: 'TransFlow Team' },
    }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: vi.fn(() => ({
    data: [
      { id: 'p1', name: 'Báo cáo tài chính Q3', sourceLang: 'en', domain: 'Finance' },
      { id: 'p2', name: 'Hướng dẫn sử dụng App', sourceLang: 'ja', domain: 'Software' },
    ],
    isLoading: false,
  })),
}))

vi.mock('@/hooks/useBatches', () => ({
  useBatches: vi.fn(() => ({
    data: [
      { id: 'b1', name: 'Batch 1', status: 'COMPLETED' },
      { id: 'b2', name: 'Batch 2', status: 'PROCESSING' },
      { id: 'b3', name: 'Batch 3', status: 'PENDING' },
    ],
    isLoading: false,
  })),
}))

vi.mock('@/hooks/useUsage', () => ({
  useUsage: vi.fn(() => ({
    data: {
      totalTokens: 128500,
      totalInputTokens: 75000,
      totalOutputTokens: 53500,
      operationCount: 42,
      cost: 'Coming soon',
      byOperation: [
        { operation: 'TRANSLATE', totalTokens: 100000, inputTokens: 60000, outputTokens: 40000, operationCount: 30 },
      ],
      byModel: [],
    },
    isLoading: false,
  })),
}))

describe('MobileDashboardPage', () => {
  const renderDashboard = () => {
    return render(
      <MemoryRouter initialEntries={['/w/ws-123']}>
        <Routes>
          <Route path="/w/:workspaceId" element={<MobileDashboardPage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders title, workspace name, and quick launch buttons', () => {
    renderDashboard()
    expect(screen.getByText('Tổng quan')).toBeInTheDocument()
    expect(screen.getByText('TransFlow Team')).toBeInTheDocument()

    // Quick launch buttons
    expect(screen.getByRole('link', { name: /dự án/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /media/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /thuật ngữ/i })).toBeInTheDocument()
  })

  it('renders KPI cards with projects count, batches count, and total tokens', () => {
    renderDashboard()
    // Projects count = 2
    expect(screen.getByText('2')).toBeInTheDocument()
    // Batches count = 3
    expect(screen.getByText('3')).toBeInTheDocument()
    // Total tokens formatted (128,500 or 128.500)
    expect(screen.getByText(/128/)).toBeInTheDocument()
  })

  it('renders recent projects list using MobileCard', () => {
    renderDashboard()
    expect(screen.getByText('Báo cáo tài chính Q3')).toBeInTheDocument()
    expect(screen.getByText('Hướng dẫn sử dụng App')).toBeInTheDocument()
  })

  it('renders empty projects state when no projects are returned', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    vi.mocked(useProjects).mockReturnValueOnce({
      data: [],
      isLoading: false,
    } as any)

    renderDashboard()
    expect(screen.getByText('Chưa có dự án nào gần đây')).toBeInTheDocument()
    expect(screen.getByText('Tạo dự án mới')).toBeInTheDocument()
  })

  it('renders loading indicators while queries are pending', async () => {
    const { useProjects } = await import('@/hooks/useProjects')
    const { useBatches } = await import('@/hooks/useBatches')
    const { useUsage } = await import('@/hooks/useUsage')

    vi.mocked(useProjects).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    } as any)
    vi.mocked(useBatches).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    } as any)
    vi.mocked(useUsage).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    } as any)

    renderDashboard()
    // Should render loading '...' placeholders
    const loadingEllipses = screen.getAllByText('...')
    expect(loadingEllipses.length).toBeGreaterThanOrEqual(1)
  })
})
