// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileAccountPage } from './MobileAccountPage'

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

const mockLogout = vi.fn()
const mockSetTheme = vi.fn()

let mockUser: any = {
  id: 'u-1',
  fullName: 'Nguyễn Văn A',
  email: 'nguyenvana@example.com',
}

let mockCurrentTheme = 'light'

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      user: mockUser,
      currentWorkspace: { id: 'ws-123', name: 'TransFlow Team' },
      logout: mockLogout,
    }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: any) =>
    selector({
      theme: mockCurrentTheme,
      setTheme: mockSetTheme,
      language: 'vi',
      setLanguage: vi.fn(),
    }),
}))

describe('MobileAccountPage', () => {
  it('renders user account sections', () => {
    render(
      <MemoryRouter>
        <MobileAccountPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Cài đặt tài khoản')).toBeInTheDocument()
    expect(screen.getByText('Hồ sơ cá nhân')).toBeInTheDocument()
    expect(screen.getByText('Bảo mật & Mật khẩu')).toBeInTheDocument()
    expect(screen.getByText('Tùy chọn thông báo')).toBeInTheDocument()
  })

  it('renders user profile summary card with avatar initial, name, and email', () => {
    render(
      <MemoryRouter>
        <MobileAccountPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument()
    expect(screen.getByText('nguyenvana@example.com')).toBeInTheDocument()
    expect(screen.getByText('N')).toBeInTheDocument()
  })

  it('renders fallback when user is null or missing fullName', () => {
    mockUser = null
    render(
      <MemoryRouter>
        <MobileAccountPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Người dùng')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
    mockUser = { id: 'u-1', fullName: 'Nguyễn Văn A', email: 'nguyenvana@example.com' }
  })

  it('renders theme toggle row and toggles theme when clicked', () => {
    render(
      <MemoryRouter>
        <MobileAccountPage />
      </MemoryRouter>
    )
    const themeRow = screen.getByTestId('theme-toggle-row')
    expect(themeRow).toBeInTheDocument()
    expect(screen.getByText(/Giao diện/i)).toBeInTheDocument()

    fireEvent.click(themeRow)
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('calls logout when clicking the logout button', () => {
    render(
      <MemoryRouter>
        <MobileAccountPage />
      </MemoryRouter>
    )
    const logoutBtn = screen.getByRole('button', { name: /đăng xuất/i })
    expect(logoutBtn).toBeInTheDocument()

    fireEvent.click(logoutBtn)
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('renders navigation links to profile, security, and notification preferences', () => {
    render(
      <MemoryRouter initialEntries={['/w/ws-123/account']}>
        <MobileAccountPage />
      </MemoryRouter>
    )
    const profileLink = screen.getByRole('link', { name: /hồ sơ cá nhân/i })
    expect(profileLink).toBeInTheDocument()
    expect(profileLink.getAttribute('href')).toContain('profile')

    const securityLink = screen.getByRole('link', { name: /bảo mật & mật khẩu/i })
    expect(securityLink).toBeInTheDocument()
    expect(securityLink.getAttribute('href')).toContain('security')

    const notificationLink = screen.getByRole('link', { name: /tùy chọn thông báo/i })
    expect(notificationLink).toBeInTheDocument()
    expect(notificationLink.getAttribute('href')).toContain('preferences')
  })
})
