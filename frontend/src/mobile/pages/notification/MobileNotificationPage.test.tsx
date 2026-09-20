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

const mockMarkAllAsRead = vi.fn()
let mockHookReturn: any = {
  notifications: [
    {
      id: 'n-1',
      title: 'Dịch video hoàn tất',
      message: 'Video presentation.mp4 đã được dịch sang tiếng Anh',
      time: '5 phút trước',
      type: 'BATCH_COMPLETED',
      read: false,
    },
    {
      id: 'n-2',
      title: 'Cảnh báo hạn ngạch',
      message: 'Bạn đã sử dụng 85% hạn ngạch token trong tháng này',
      time: '1 giờ trước',
      type: 'BATCH_PARTIALLY_FAILED',
      read: true,
    },
  ],
  isLoading: false,
  markAllAsRead: mockMarkAllAsRead,
}

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => mockHookReturn,
}))

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

describe('MobileNotificationPage', () => {
  it('renders page header and action button', () => {
    render(
      <MemoryRouter>
        <MobileNotificationPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Thông báo')).toBeInTheDocument()
    expect(screen.getByText('Đọc tất cả')).toBeInTheDocument()
  })

  it('renders list of notifications with title, message, and time', () => {
    render(
      <MemoryRouter>
        <MobileNotificationPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Dịch video hoàn tất')).toBeInTheDocument()
    expect(
      screen.getByText('Video presentation.mp4 đã được dịch sang tiếng Anh')
    ).toBeInTheDocument()
    expect(screen.getByText('5 phút trước')).toBeInTheDocument()

    expect(screen.getByText('Cảnh báo hạn ngạch')).toBeInTheDocument()
    expect(screen.getByText('1 giờ trước')).toBeInTheDocument()
  })

  it('renders loading state when isLoading is true', () => {
    mockHookReturn = {
      notifications: [],
      isLoading: true,
    }
    render(
      <MemoryRouter>
        <MobileNotificationPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Đang tải thông báo...')).toBeInTheDocument()
  })

  it('renders empty state when there are no notifications', () => {
    mockHookReturn = {
      notifications: [],
      isLoading: false,
    }
    render(
      <MemoryRouter>
        <MobileNotificationPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Không có thông báo mới')).toBeInTheDocument()
  })

  it('handles markAllAsRead when clicking "Đọc tất cả"', () => {
    mockHookReturn = {
      notifications: [
        {
          id: 'n-1',
          title: 'Dịch hoàn tất',
          message: 'Tài liệu đã xong',
          time: 'Vừa xong',
          read: false,
        },
      ],
      isLoading: false,
      markAllAsRead: mockMarkAllAsRead,
    }
    render(
      <MemoryRouter>
        <MobileNotificationPage />
      </MemoryRouter>
    )
    const markAllBtn = screen.getByRole('button', { name: /đọc tất cả/i })
    fireEvent.click(markAllBtn)
    expect(mockMarkAllAsRead).toHaveBeenCalled()
  })

  it('defensively handles real TanStack query shape { data: [...] } with createdAt', () => {
    mockHookReturn = {
      data: [
        {
          id: 'n-real-1',
          type: 'BATCH_COMPLETED',
          title: 'Batch completed successfully',
          message: 'All 10 segments translated',
          relatedEntityType: 'BATCH',
          relatedEntityId: 'b-123',
          payload: {},
          createdAt: new Date(Date.now() - 60000).toISOString(),
        },
      ],
      isLoading: false,
    }
    render(
      <MemoryRouter>
        <MobileNotificationPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Batch completed successfully')).toBeInTheDocument()
    expect(screen.getByText('All 10 segments translated')).toBeInTheDocument()
  })
})
