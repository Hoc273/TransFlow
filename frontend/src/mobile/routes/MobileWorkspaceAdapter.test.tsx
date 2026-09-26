// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileWorkspaceAdapter } from './MobileWorkspaceAdapter'

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

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}))

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(() => ({ data: [], isLoading: false })),
  useNotificationsInfinite: vi.fn(() => ({ data: { pages: [] }, isLoading: false })),
  useUnreadNotificationCount: vi.fn(() => ({ data: 0 })),
  useMarkNotificationRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMarkAllNotificationsRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('@/hooks/useWorkspaces', () => ({
  useWorkspaces: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateWorkspace: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIsMobile } from '../hooks/useIsMobile'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

describe('MobileWorkspaceAdapter', () => {
  it('renders desktop AppShell when useIsMobile returns false', () => {
    vi.mocked(useIsMobile).mockReturnValue(false)
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/w/w1']}>
          <Routes>
            <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    // Desktop AppShell has app-shell class
    expect(document.querySelector('.app-shell')).toBeInTheDocument()
  })

  it('renders MobileAppShell when useIsMobile returns true', () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/w/w1']}>
          <Routes>
            <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Menu')).toBeInTheDocument()
  })

  it('renders MediaJobPage inside mobile-safe wrapper when useIsMobile is true', () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/w/w1/media/jobs/job-999']}>
          <Routes>
            <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    // Mobile wrapper keeps MobileBottomNav for consistent mobile navigation
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    // It should NOT render desktop AppShell on mobile (overflow fix)
    expect(document.querySelector('.app-shell')).not.toBeInTheDocument()
  })

  it('renders MobileAppShell on /media and /media/presets when useIsMobile is true (not exempted)', () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/w/w1/media']}>
          <Routes>
            <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Menu')).toBeInTheDocument()
    expect(document.querySelector('.app-shell')).not.toBeInTheDocument()

    unmount()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/w/w1/media/presets']}>
          <Routes>
            <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Menu')).toBeInTheDocument()
    expect(document.querySelector('.app-shell')).not.toBeInTheDocument()
  })
})
