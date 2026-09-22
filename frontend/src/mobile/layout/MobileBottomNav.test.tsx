// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileBottomNav } from './MobileBottomNav'

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

describe('MobileBottomNav', () => {
  it('renders primary navigation tabs', () => {
    render(
      <MemoryRouter>
        <MobileBottomNav workspaceId="w1" onOpenMenu={vi.fn()} />
      </MemoryRouter>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByText('Menu')).toBeInTheDocument()
    expect(screen.queryByText('Batches')).not.toBeInTheDocument()
  })

  it('triggers onOpenMenu when Menu tab is clicked', () => {
    const handleOpenMenu = vi.fn()
    render(
      <MemoryRouter>
        <MobileBottomNav workspaceId="w1" onOpenMenu={handleOpenMenu} />
      </MemoryRouter>
    )
    fireEvent.click(screen.getByText('Menu'))
    expect(handleOpenMenu).toHaveBeenCalledTimes(1)
  })
})
