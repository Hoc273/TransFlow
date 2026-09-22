// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PlatformGuard } from './PlatformGuard'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const authState = vi.hoisted(() => ({
  token: null as string | null,
  user: null as { isPlatformAdmin?: boolean } | null,
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { accessToken: authState.token, user: authState.user }
    return selector ? selector(state) : state
  },
}))

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/platform']}>
      <Routes>
        <Route path="/platform" element={<PlatformGuard>SECRET</PlatformGuard>} />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PlatformGuard', () => {
  it('chưa login → /login', () => {
    authState.token = null
    authState.user = null
    renderGuard()
    expect(screen.getByText('LOGIN')).toBeTruthy()
  })

  it('user thường → /dashboard', () => {
    authState.token = 'tok'
    authState.user = { isPlatformAdmin: false }
    renderGuard()
    expect(screen.getByText('DASHBOARD')).toBeTruthy()
  })

  it('platform admin → render children', () => {
    authState.token = 'tok'
    authState.user = { isPlatformAdmin: true }
    renderGuard()
    expect(screen.getByText('SECRET')).toBeTruthy()
  })
})
