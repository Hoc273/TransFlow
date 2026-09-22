// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileUsagePage } from './MobileUsagePage'

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

vi.mock('@/hooks/useUsage', () => ({
  useUsage: vi.fn(() => ({
    data: {
      totalTokens: 128500,
      totalInputTokens: 75000,
      totalOutputTokens: 53500,
      operationCount: 42,
      cost: 'Coming soon',
      byOperation: [
        {
          operation: 'TRANSLATE',
          totalTokens: 100000,
          inputTokens: 60000,
          outputTokens: 40000,
          operationCount: 30,
        },
        {
          operation: 'QA',
          totalTokens: 28500,
          inputTokens: 15000,
          outputTokens: 13500,
          operationCount: 12,
        },
      ],
      byModel: [
        {
          provider: 'google',
          model: 'gemini-1.5-pro',
          totalTokens: 128500,
          inputTokens: 75000,
          outputTokens: 53500,
          operationCount: 42,
        },
      ],
    },
    isLoading: false,
    isError: false,
  })),
}))

describe('MobileUsagePage', () => {
  const renderUsagePage = () => {
    return render(
      <MemoryRouter initialEntries={['/w/ws-123/dashboard/usage']}>
        <Routes>
          <Route path="/w/:workspaceId/dashboard/usage" element={<MobileUsagePage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders usage title and token summary cards', () => {
    renderUsagePage()
    expect(screen.getByText(/Hạn ngạch & Mức sử dụng/i)).toBeInTheDocument()

    // Total tokens formatted (appears in summary and model card)
    const tokensElements = screen.getAllByText(/128\.500/)
    expect(tokensElements.length).toBeGreaterThanOrEqual(1)

    // Input tokens formatted
    const inputElements = screen.getAllByText(/75\.000/)
    expect(inputElements.length).toBeGreaterThanOrEqual(1)

    // Output tokens formatted
    const outputElements = screen.getAllByText(/53\.500/)
    expect(outputElements.length).toBeGreaterThanOrEqual(1)

    // Estimated cost
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument()
  })

  it('renders operation and model breakdowns', () => {
    renderUsagePage()
    expect(screen.getByText('TRANSLATE')).toBeInTheDocument()
    expect(screen.getByText('QA')).toBeInTheDocument()
    expect(screen.getByText('gemini-1.5-pro')).toBeInTheDocument()
  })

  it('renders loading state properly', async () => {
    const { useUsage } = await import('@/hooks/useUsage')
    vi.mocked(useUsage).mockReturnValueOnce({
      data: undefined,
      isLoading: true,
      isError: false,
    } as any)

    renderUsagePage()
    expect(screen.getByText(/Đang tải dữ liệu hạn ngạch/i)).toBeInTheDocument()
  })

  it('renders error state properly', async () => {
    const { useUsage } = await import('@/hooks/useUsage')
    vi.mocked(useUsage).mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      isError: true,
    } as any)

    renderUsagePage()
    expect(screen.getByText(/Không thể tải dữ liệu mức sử dụng AI/i)).toBeInTheDocument()
  })
})
