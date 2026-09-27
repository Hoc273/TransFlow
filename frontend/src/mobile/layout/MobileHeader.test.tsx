// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/i18n'
import { MobileHeader } from './MobileHeader'
import { MobileMenuDrawer } from './MobileMenuDrawer'

vi.mock('@/hooks/useCredit', () => ({
  useUserCredit: () => ({ data: { balance: 12500 }, isLoading: false }),
}))

vi.mock('../components/MobileWorkspaceSwitcher', () => ({
  MobileWorkspaceSwitcher: () => <div data-testid="ws-switcher" />,
}))

vi.mock('@/components/layout/AvatarMenu', () => ({
  AvatarMenu: ({ guideInNewTab }: { guideInNewTab?: boolean }) => (
    <div data-testid="avatar-menu" data-guide-new-tab={String(guideInNewTab)} />
  ),
}))

beforeAll(async () => {
  await i18n.changeLanguage('vi')
})

afterEach(cleanup)

describe('MobileHeader', () => {
  it('shows the logo without the TransFlow wordmark, next to the workspace switcher', () => {
    render(
      <MemoryRouter>
        <MobileHeader workspaceId="ws-1" />
      </MemoryRouter>,
    )
    const logo = screen.getByRole('img', { name: 'TransFlow' })
    expect(logo.getAttribute('src')).toBe('/favicon.svg')
    expect(screen.queryByText('TransFlow')).toBeNull()
    expect(screen.getByTestId('ws-switcher')).toBeTruthy()
  })

  it('shows the credit balance linking to the credit page', () => {
    render(
      <MemoryRouter>
        <MobileHeader workspaceId="ws-1" />
      </MemoryRouter>,
    )
    const chip = screen.getByTestId('mobile-header-credit')
    expect(chip.getAttribute('href')).toBe('/w/ws-1/account/credit')
    expect(chip.textContent).toMatch(/12/)
  })

  it('opens the Guide in the same tab from the avatar menu', () => {
    render(
      <MemoryRouter>
        <MobileHeader workspaceId="ws-1" />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('avatar-menu').getAttribute('data-guide-new-tab')).toBe('false')
  })
})

describe('MobileMenuDrawer', () => {
  it('uses Vietnamese labels, shows credit, a same-tab Guide link and an inline language picker', () => {
    render(
      <MemoryRouter>
        <MobileMenuDrawer isOpen onClose={() => {}} workspaceId="ws-1" />
      </MemoryRouter>,
    )
    expect(screen.getByText('Từ điển thuật ngữ')).toBeTruthy()
    expect(screen.queryByText(/Glossaries/)).toBeNull()
    expect(screen.getByTestId('mobile-menu-credit').textContent).toMatch(/12[.,]500/)

    const guide = screen.getByRole('link', { name: 'Hướng dẫn' })
    expect(guide.getAttribute('href')).toBe('/guide')
    expect(guide.getAttribute('target')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'English' }))
    expect(i18n.language).toBe('en')
    void i18n.changeLanguage('vi')
  })
})
