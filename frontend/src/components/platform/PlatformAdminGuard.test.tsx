// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PlatformAdminGuard } from './PlatformAdminGuard'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types/auth'

const meState: {
  data?: Partial<User>
  dataUpdatedAt: number
  isError: boolean
  refetch: () => void
} = { dataUpdatedAt: 0, isError: false, refetch: vi.fn() }

/** A /auth/me answer received after the guard mounted. */
function serverSays(isPlatformAdmin: boolean) {
  meState.data = { isPlatformAdmin }
  meState.dataUpdatedAt = Date.now() + 60_000
}

/** A cached answer from before the user entered /platform (e.g. before a demotion). */
function cacheSays(isPlatformAdmin: boolean) {
  meState.data = { isPlatformAdmin }
  meState.dataUpdatedAt = Date.now() - 10_000
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'vi' } }),
}))

vi.mock('@/hooks/usePlatform', () => ({
  usePlatformMe: () => meState,
}))

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/platform']}>
      <Routes>
        <Route element={<PlatformAdminGuard />}>
          <Route path="/platform" element={<div>admin shell</div>} />
        </Route>
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function signIn(isPlatformAdmin: boolean) {
  useAuthStore.setState({ accessToken: 'token', user: { isPlatformAdmin } as User })
}

beforeEach(() => {
  meState.data = undefined
  meState.dataUpdatedAt = 0
  meState.isError = false
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ accessToken: null, user: null })
})

describe('PlatformAdminGuard', () => {
  it('redirects signed-out visitors to login', () => {
    renderGuard()
    expect(screen.getByText('login page')).toBeTruthy()
  })

  it('shows 403 to a regular user', () => {
    signIn(false)
    serverSays(false)
    renderGuard()
    expect(screen.getByText('403')).toBeTruthy()
    expect(screen.queryByText('admin shell')).toBeNull()
  })

  it('does not trust a stale stored admin flag once the server says otherwise', () => {
    signIn(true)
    serverSays(false)
    renderGuard()
    expect(screen.queryByText('admin shell')).toBeNull()
  })

  it('does not open the shell from a cached admin answer while re-checking', () => {
    signIn(true)
    cacheSays(true)
    renderGuard()
    expect(screen.getByText('guard.loading')).toBeTruthy()
    expect(screen.queryByText('admin shell')).toBeNull()
  })

  it('keeps the shell closed when the re-check fails', () => {
    signIn(true)
    cacheSays(true)
    meState.isError = true
    renderGuard()
    expect(screen.getByText('guard.checkFailed')).toBeTruthy()
    expect(screen.queryByText('admin shell')).toBeNull()
  })

  it('waits for the server before rendering the shell', () => {
    signIn(true)
    renderGuard()
    expect(screen.getByText('guard.loading')).toBeTruthy()
    expect(screen.queryByText('admin shell')).toBeNull()
  })

  it('renders the shell for a platform admin', () => {
    signIn(false)
    serverSays(true)
    renderGuard()
    expect(screen.getByText('admin shell')).toBeTruthy()
  })
})
