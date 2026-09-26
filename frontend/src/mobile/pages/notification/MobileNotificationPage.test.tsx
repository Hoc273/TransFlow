// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileNotificationPage } from './MobileNotificationPage'

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

const mockMarkAll = vi.fn()
const mockMarkRead = vi.fn()
const mockNavigate = vi.fn()

function item(overrides: Record<string, unknown>) {
  return {
    id: 'n-1',
    type: 'JOB_COMPLETED',
    title: 'JOB_COMPLETED',
    message: '',
    relatedEntityType: 'MEDIA_JOB',
    relatedEntityId: 'job-1',
    payload: null,
    readAt: null,
    isRead: false,
    createdAt: new Date(Date.now() - 60000).toISOString(),
    ...overrides,
  }
}

let mockPages: any[][] = []
let mockLoading = false
let mockUnread = 0

vi.mock('@/hooks/useNotifications', () => ({
  useNotificationsInfinite: () => ({
    data: { pages: mockPages },
    isLoading: mockLoading,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
  useUnreadNotificationCount: () => ({ data: mockUnread }),
  useMarkNotificationRead: () => ({ mutate: mockMarkRead, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: mockMarkAll, isPending: false }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      currentWorkspace: { id: 'ws-123', name: 'TransFlow Team' },
    }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: any) =>
    selector({
      language: 'vi',
    }),
}))

const renderPage = () =>
  render(
    <MemoryRouter>
      <MobileNotificationPage />
    </MemoryRouter>,
  )

describe('MobileNotificationPage', () => {
  it('renders header and mark-all button', () => {
    mockPages = [[]]
    renderPage()
    expect(screen.getByText('Thông báo')).toBeInTheDocument()
    expect(screen.getByText('Đọc tất cả')).toBeInTheDocument()
  })

  it('renders notifications with message and marks unread ones', () => {
    mockPages = [[
      item({ id: 'n-1', title: 'Dịch video hoàn tất', message: 'Video đã xong', type: 'CUSTOM_A' }),
      item({ id: 'n-2', title: 'Đã đọc', message: 'Cũ', type: 'CUSTOM_B', isRead: true, readAt: '2026-01-01T00:00:00Z' }),
    ]]
    mockUnread = 1
    renderPage()
    expect(screen.getByText('Dịch video hoàn tất')).toBeInTheDocument()
    expect(screen.getByText('Video đã xong')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Chưa đọc')).toHaveLength(1)
  })

  it('renders loading state', () => {
    mockPages = []
    mockLoading = true
    renderPage()
    expect(screen.getByText('Đang tải thông báo...')).toBeInTheDocument()
    mockLoading = false
  })

  it('renders empty state when there are no notifications', () => {
    mockPages = [[]]
    renderPage()
    expect(screen.getByText('Không có thông báo mới')).toBeInTheDocument()
  })

  it('marks all as read through the API mutation', () => {
    mockPages = [[item({})]]
    mockUnread = 1
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /đọc tất cả/i }))
    expect(mockMarkAll).toHaveBeenCalled()
  })

  it('clicking an unread job notification marks it read and opens the job', () => {
    mockPages = [[item({ id: 'n-9', relatedEntityId: 'job-42', message: 'Media job completed' })]]
    mockUnread = 1
    renderPage()
    fireEvent.click(screen.getByText('Media job completed'))
    expect(mockMarkRead).toHaveBeenCalledWith('n-9')
    expect(mockNavigate).toHaveBeenCalledWith('/w/ws-123/media/jobs/job-42')
  })
})
