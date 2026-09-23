# Mobile UI Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent, touch-first Mobile UI in `frontend/src/mobile/` for the TransFlow Workspace while preserving 100% desktop functionality, keeping desktop code intact, and exempting `MediaJobPage` (`/w/:workspaceId/media/jobs/:jobId`) from layout changes.

**Architecture:** Implement all mobile components, layouts, and pages inside a dedicated `frontend/src/mobile/` directory. Reuse existing data hooks, Zustand stores, and translation assets directly. Integrate a thin adaptive switcher (`MobileWorkspaceAdapter`) at the `AppShell` boundary to automatically mount the mobile shell when viewport width < 768px.

**Tech Stack:** React 19, TypeScript, TailwindCSS v4, React Router 7, `@tabler/icons-react`, Zustand, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-ui-adaptation-design.md`

## Global Constraints
- Target directory: 100% of mobile UI code resides inside `frontend/src/mobile/`.
- Zero desktop breakage: Existing desktop pages and components must not be modified or regressed.
- Media studio invariant: `MediaJobPage` (`/w/:workspaceId/media/jobs/:jobId`) is rendered directly as-is on all devices.
- Feature parity: Every list, search, filter, status badge, action, and modal from desktop must be accessible on mobile.
- Breakpoint: `< 768px` is mobile; `>= 768px` is desktop.

---

### Task 1: Viewport Detection Hook & Mobile Touch Primitives

**Files:**
- Create: `frontend/src/mobile/hooks/useIsMobile.ts`
- Create: `frontend/src/mobile/components/MobileCard.tsx`
- Create: `frontend/src/mobile/components/BottomSheet.tsx`
- Create: `frontend/src/mobile/components/MobileActionMenu.tsx`
- Create: `frontend/src/mobile/components/MobileEmptyState.tsx`
- Create: `frontend/src/mobile/components/MobileSearchFilter.tsx`
- Test: `frontend/src/mobile/hooks/useIsMobile.test.ts`
- Test: `frontend/src/mobile/components/BottomSheet.test.tsx`

**Interfaces:**
- Produces: `useIsMobile(breakpoint?: number): boolean`
- Produces: `MobileCard({ children, className, onClick, ...props })`
- Produces: `BottomSheet({ isOpen, onClose, title, children })`
- Produces: `MobileActionMenu({ isOpen, onClose, title, actions: Array<{ label, icon, onClick, danger?: boolean }> })`
- Produces: `MobileEmptyState({ icon, title, description, action })`
- Produces: `MobileSearchFilter({ value, onChange, placeholder, filters, activeFilter, onFilterChange })`

- [ ] **Step 1: Write failing tests for `useIsMobile` and `BottomSheet`**

Create `frontend/src/mobile/hooks/useIsMobile.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsMobile } from './useIsMobile'

describe('useIsMobile', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when window width is less than 768px', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false when window width is 768px or greater', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })
})
```

Create `frontend/src/mobile/components/BottomSheet.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'

describe('BottomSheet', () => {
  it('renders title and children when isOpen is true', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Sheet Content</div>
      </BottomSheet>
    )
    expect(screen.getByText('Test Sheet')).toBeInTheDocument()
    expect(screen.getByText('Sheet Content')).toBeInTheDocument()
  })

  it('calls onClose when backdrop or close button is clicked', () => {
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen={true} onClose={handleClose} title="Test Sheet">
        <div>Sheet Content</div>
      </BottomSheet>
    )
    const closeBtn = screen.getByLabelText('Close sheet')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/mobile/hooks/useIsMobile.test.ts src/mobile/components/BottomSheet.test.tsx --run`
Expected: FAIL with missing module imports.

- [ ] **Step 3: Implement `useIsMobile` and mobile touch primitives**

Create `frontend/src/mobile/hooks/useIsMobile.ts`:
```ts
import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }

    setIsMobile(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])

  return isMobile
}
```

Create `frontend/src/mobile/components/MobileCard.tsx`:
```tsx
import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

interface MobileCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  interactive?: boolean
}

export function MobileCard({ children, className, interactive = false, ...props }: MobileCardProps) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-neutral-200 bg-white p-4 shadow-xs dark:border-neutral-800 dark:bg-neutral-900',
        interactive && 'active:scale-[0.99] transition-transform duration-75 cursor-pointer hover:border-neutral-300 dark:hover:border-neutral-700',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
```

Create `frontend/src/mobile/components/BottomSheet.tsx`:
```tsx
import { useEffect, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import clsx from 'clsx'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function BottomSheet({ isOpen, onClose, title, children, className }: BottomSheetProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        aria-label="Close backdrop"
        onClick={onClose}
      />
      <div
        className={clsx(
          'relative z-10 max-h-[85vh] w-full overflow-hidden rounded-t-2xl border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 shadow-2xl flex flex-col',
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-8 rounded-full bg-neutral-300 dark:bg-neutral-700 mx-auto absolute top-2 left-1/2 -translate-x-1/2" />
            {title && <h3 className="text-base font-semibold text-neutral-900 dark:text-white pt-1">{title}</h3>}
          </div>
          <button
            type="button"
            className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close sheet"
            onClick={onClose}
          >
            <IconX size={20} />
          </button>
        </div>
        <div className="overflow-y-auto p-4 overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  )
}
```

Create `frontend/src/mobile/components/MobileActionMenu.tsx`:
```tsx
import type { ReactNode } from 'react'
import { BottomSheet } from './BottomSheet'
import clsx from 'clsx'

export interface MobileActionItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
}

interface MobileActionMenuProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  actions: MobileActionItem[]
}

export function MobileActionMenu({ isOpen, onClose, title, actions }: MobileActionMenuProps) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-1">
        {actions.map((act, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              act.onClick()
              onClose()
            }}
            className={clsx(
              'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors active:bg-neutral-100 dark:active:bg-neutral-800',
              act.danger ? 'text-red-600 dark:text-red-400' : 'text-neutral-800 dark:text-neutral-200'
            )}
          >
            {act.icon && <span className="shrink-0">{act.icon}</span>}
            <span className="flex-1">{act.label}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
```

Create `frontend/src/mobile/components/MobileEmptyState.tsx`:
```tsx
import type { ReactNode } from 'react'

interface MobileEmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function MobileEmptyState({ icon, title, description, action }: MobileEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 p-8 text-center dark:border-neutral-800">
      {icon && <div className="mb-3 text-neutral-400 dark:text-neutral-500">{icon}</div>}
      <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</h4>
      {description && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
```

Create `frontend/src/mobile/components/MobileSearchFilter.tsx`:
```tsx
import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'

interface FilterOption {
  id: string
  label: string
}

interface MobileSearchFilterProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  filters?: FilterOption[]
  activeFilter?: string
  onFilterChange?: (filterId: string) => void
}

export function MobileSearchFilter({
  value,
  onChange,
  placeholder = 'Tìm kiếm...',
  filters,
  activeFilter,
  onFilterChange,
}: MobileSearchFilterProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative">
        <IconSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 py-2.5 pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:focus:bg-neutral-900"
        />
      </div>
      {filters && filters.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {filters.map((f) => {
            const active = activeFilter === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilterChange?.(f.id)}
                className={clsx(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                )}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/mobile/hooks/useIsMobile.test.ts src/mobile/components/BottomSheet.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/hooks/ frontend/src/mobile/components/
git commit -m "feat(mobile): add useIsMobile hook and touch-first primitives"
```

---

### Task 2: Mobile Navigation & Master Shell

**Files:**
- Create: `frontend/src/mobile/layout/MobileHeader.tsx`
- Create: `frontend/src/mobile/layout/MobileBottomNav.tsx`
- Create: `frontend/src/mobile/layout/MobileMenuDrawer.tsx`
- Create: `frontend/src/mobile/layout/MobileAppShell.tsx`
- Test: `frontend/src/mobile/layout/MobileBottomNav.test.tsx`

**Interfaces:**
- Produces: `MobileHeader({ onOpenMenu, workspaceId })`
- Produces: `MobileBottomNav({ activeTab, onSelectTab, workspaceId })`
- Produces: `MobileMenuDrawer({ isOpen, onClose, workspaceId })`
- Produces: `MobileAppShell()`

- [ ] **Step 1: Write failing test for `MobileBottomNav`**

Create `frontend/src/mobile/layout/MobileBottomNav.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileBottomNav } from './MobileBottomNav'

describe('MobileBottomNav', () => {
  it('renders 5 primary navigation tabs', () => {
    render(
      <MemoryRouter>
        <MobileBottomNav workspaceId="w1" onOpenMenu={vi.fn()} />
      </MemoryRouter>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Batches')).toBeInTheDocument()
    expect(screen.getByText('Media')).toBeInTheDocument()
    expect(screen.getByText('Menu')).toBeInTheDocument()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/layout/MobileBottomNav.test.tsx --run`
Expected: FAIL with missing module imports.

- [ ] **Step 3: Implement `MobileHeader`, `MobileBottomNav`, `MobileMenuDrawer`, and `MobileAppShell`**

Create `frontend/src/mobile/layout/MobileHeader.tsx`:
```tsx
import { Link } from 'react-router-dom'
import { IconBell, IconSearch, IconSparkles } from '@tabler/icons-react'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { AvatarMenu } from '@/components/layout/AvatarMenu'

interface MobileHeaderProps {
  workspaceId?: string
  onOpenSearch?: () => void
}

export function MobileHeader({ workspaceId, onOpenSearch }: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-neutral-200 bg-white/95 px-3 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95">
      <div className="flex items-center gap-2">
        <Link to={`/w/${workspaceId}`} className="flex items-center gap-1.5 font-bold text-primary">
          <IconSparkles size={20} className="text-primary" />
          <span className="text-base font-semibold tracking-tight text-neutral-900 dark:text-white">TransFlow</span>
        </Link>
        <div className="scale-90 origin-left">
          <WorkspaceSwitcher />
        </div>
      </div>

      <div className="flex items-center gap-1">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            aria-label="Search"
          >
            <IconSearch size={18} />
          </button>
        )}
        <Link
          to={`/w/${workspaceId}/notifications`}
          className="relative rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label="Notifications"
        >
          <IconBell size={18} />
        </Link>
        <div className="scale-90 origin-right">
          <AvatarMenu />
        </div>
      </div>
    </header>
  )
}
```

Create `frontend/src/mobile/layout/MobileBottomNav.tsx`:
```tsx
import { NavLink } from 'react-router-dom'
import {
  IconFolder,
  IconLayersLinked,
  IconLayoutDashboard,
  IconMenu2,
  IconVideo,
} from '@tabler/icons-react'
import clsx from 'clsx'

interface MobileBottomNavProps {
  workspaceId?: string
  onOpenMenu: () => void
}

export function MobileBottomNav({ workspaceId, onOpenMenu }: MobileBottomNavProps) {
  const base = `/w/${workspaceId}`

  const navItems = [
    { label: 'Dashboard', to: base, icon: <IconLayoutDashboard size={20} />, end: true },
    { label: 'Projects', to: `${base}/projects`, icon: <IconFolder size={20} /> },
    { label: 'Batches', to: `${base}/batches`, icon: <IconLayersLinked size={20} /> },
    { label: 'Media', to: `${base}/media`, icon: <IconVideo size={20} /> },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-neutral-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            clsx(
              'flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors',
              isActive
                ? 'text-primary dark:text-primary font-semibold'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
            )
          }
        >
          {item.icon}
          <span className="mt-0.5">{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors"
      >
        <IconMenu2 size={20} />
        <span className="mt-0.5">Menu</span>
      </button>
    </nav>
  )
}
```

Create `frontend/src/mobile/layout/MobileMenuDrawer.tsx`:
```tsx
import { Link } from 'react-router-dom'
import {
  IconBook,
  IconChartBar,
  IconMoon,
  IconSun,
  IconUser,
  IconUsers,
  IconAdjustments,
  IconLogout,
} from '@tabler/icons-react'
import { BottomSheet } from '../components/BottomSheet'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'

interface MobileMenuDrawerProps {
  isOpen: boolean
  onClose: () => void
  workspaceId?: string
}

export function MobileMenuDrawer({ isOpen, onClose, workspaceId }: MobileMenuDrawerProps) {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const logout = useAuthStore((s) => s.logout)

  const links = [
    { label: 'Glossaries (Từ điển thuật ngữ)', to: `/w/${workspaceId}/glossaries`, icon: <IconBook size={18} /> },
    { label: 'Workflow Presets (Cấu hình pipeline)', to: `/w/${workspaceId}/media/presets`, icon: <IconAdjustments size={18} /> },
    { label: 'Members (Quản lý thành viên)', to: `/w/${workspaceId}/settings/members`, icon: <IconUsers size={18} /> },
    { label: 'Usage & Quotas (Hạn ngạch)', to: `/w/${workspaceId}/dashboard/usage`, icon: <IconChartBar size={18} /> },
    { label: 'Account & Settings (Tài khoản)', to: `/w/${workspaceId}/account/profile`, icon: <IconUser size={18} /> },
  ]

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Khám phá Workspace">
      <div className="flex flex-col gap-1 pb-4">
        {links.map((lnk) => (
          <Link
            key={lnk.to}
            to={lnk.to}
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-neutral-800 transition-colors active:bg-neutral-100 dark:text-neutral-200 dark:active:bg-neutral-800"
          >
            <span className="text-neutral-500">{lnk.icon}</span>
            <span>{lnk.label}</span>
          </Link>
        ))}

        <div className="my-2 border-t border-neutral-100 dark:border-neutral-800" />

        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-neutral-800 transition-colors active:bg-neutral-100 dark:text-neutral-200 dark:active:bg-neutral-800"
        >
          <div className="flex items-center gap-3">
            {theme === 'dark' ? <IconSun size={18} className="text-yellow-500" /> : <IconMoon size={18} className="text-neutral-500" />}
            <span>Giao diện {theme === 'dark' ? 'Sáng' : 'Tối'}</span>
          </div>
          <span className="text-xs text-neutral-400 capitalize">{theme}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose()
            logout()
          }}
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-red-600 transition-colors active:bg-red-50 dark:text-red-400 dark:active:bg-neutral-800"
        >
          <IconLogout size={18} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </BottomSheet>
  )
}
```

Create `frontend/src/mobile/layout/MobileAppShell.tsx`:
```tsx
import { useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { MobileHeader } from './MobileHeader'
import { MobileBottomNav } from './MobileBottomNav'
import { MobileMenuDrawer } from './MobileMenuDrawer'
import { GlobalSearchModal } from '@/components/layout/GlobalSearchModal'

export function MobileAppShell() {
  const { workspaceId } = useParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 flex flex-col">
      <MobileHeader workspaceId={workspaceId} onOpenSearch={() => setSearchOpen(true)} />
      <main className="flex-1 pb-20 px-3 py-3 overflow-y-auto">
        <Outlet />
      </main>
      <MobileBottomNav workspaceId={workspaceId} onOpenMenu={() => setMenuOpen(true)} />
      <MobileMenuDrawer isOpen={menuOpen} onClose={() => setMenuOpen(false)} workspaceId={workspaceId} />
      <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/layout/MobileBottomNav.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/layout/
git commit -m "feat(mobile): add mobile shell, header, bottom nav, and menu drawer"
```

---

### Task 3: Mobile Dashboard & Usage Pages

**Files:**
- Create: `frontend/src/mobile/pages/dashboard/MobileDashboardPage.tsx`
- Create: `frontend/src/mobile/pages/dashboard/MobileUsagePage.tsx`
- Test: `frontend/src/mobile/pages/dashboard/MobileDashboardPage.test.tsx`

**Interfaces:**
- Produces: `MobileDashboardPage()`
- Produces: `MobileUsagePage()`
- Consumes: `@/hooks/useDashboard`, `@/hooks/useUsage`, `MobileCard`

- [ ] **Step 1: Write test for `MobileDashboardPage`**

Create `frontend/src/mobile/pages/dashboard/MobileDashboardPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileDashboardPage } from './MobileDashboardPage'

vi.mock('@/hooks/useDashboard', () => ({
  useDashboard: () => ({
    stats: {
      totalProjects: 12,
      activeBatches: 3,
      mediaJobs: 45,
      wordsTranslated: 128500,
    },
    activities: [
      { id: '1', title: 'Video Marketing Q3', type: 'media', status: 'COMPLETED', time: '10 phút trước' },
    ],
    isLoading: false,
  }),
}))

describe('MobileDashboardPage', () => {
  it('renders stats and recent activities', () => {
    render(
      <MemoryRouter>
        <MobileDashboardPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Tổng quan')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Video Marketing Q3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/dashboard/MobileDashboardPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileDashboardPage` and `MobileUsagePage`**

Create `frontend/src/mobile/pages/dashboard/MobileDashboardPage.tsx`:
```tsx
import { Link, useParams } from 'react-router-dom'
import { IconFolder, IconLayersLinked, IconVideo, IconLanguage, IconPlus, IconArrowRight } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { useDashboard } from '@/hooks/useDashboard'

export function MobileDashboardPage() {
  const { workspaceId } = useParams()
  const { stats, activities, isLoading } = useDashboard()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Tổng quan</h1>
        <Link
          to={`/w/${workspaceId}/projects`}
          className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          <span>Dự án</span>
          <IconArrowRight size={14} />
        </Link>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <MobileCard className="flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium">Dự án</span>
            <IconFolder size={16} className="text-blue-500" />
          </div>
          <span className="text-2xl font-bold">{isLoading ? '...' : stats?.totalProjects ?? 0}</span>
        </MobileCard>

        <MobileCard className="flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium">Lô dịch (Batches)</span>
            <IconLayersLinked size={16} className="text-indigo-500" />
          </div>
          <span className="text-2xl font-bold">{isLoading ? '...' : stats?.activeBatches ?? 0}</span>
        </MobileCard>

        <MobileCard className="flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium">Media Jobs</span>
            <IconVideo size={16} className="text-emerald-500" />
          </div>
          <span className="text-2xl font-bold">{isLoading ? '...' : stats?.mediaJobs ?? 0}</span>
        </MobileCard>

        <MobileCard className="flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between text-neutral-500">
            <span className="text-xs font-medium">Từ đã dịch</span>
            <IconLanguage size={16} className="text-amber-500" />
          </div>
          <span className="text-2xl font-bold">
            {isLoading ? '...' : stats?.wordsTranslated ? stats.wordsTranslated.toLocaleString() : 0}
          </span>
        </MobileCard>
      </div>

      {/* Quick Action Tiles */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Thao tác nhanh</h2>
        <div className="grid grid-cols-2 gap-2">
          <Link
            to={`/w/${workspaceId}/media`}
            className="flex items-center gap-2 rounded-xl bg-primary/10 dark:bg-primary/20 p-3 text-primary font-medium text-xs active:scale-95 transition-transform"
          >
            <IconPlus size={16} />
            <span>Tạo Media Job</span>
          </Link>
          <Link
            to={`/w/${workspaceId}/projects`}
            className="flex items-center gap-2 rounded-xl bg-neutral-200/60 dark:bg-neutral-800 p-3 text-neutral-800 dark:text-neutral-200 font-medium text-xs active:scale-95 transition-transform"
          >
            <IconPlus size={16} />
            <span>Thêm Dự án mới</span>
          </Link>
        </div>
      </div>

      {/* Recent Activities */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Hoạt động gần đây</h2>
        {activities && activities.length > 0 ? (
          <div className="space-y-2">
            {activities.map((act) => (
              <MobileCard key={act.id} className="flex items-center justify-between py-2.5 px-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-900 dark:text-white line-clamp-1">{act.title}</span>
                  <span className="text-[11px] text-neutral-500">{act.time}</span>
                </div>
                <span className="rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                  {act.status}
                </span>
              </MobileCard>
            ))}
          </div>
        ) : (
          <MobileCard className="py-6 text-center text-xs text-neutral-400">
            Chưa có hoạt động nào gần đây
          </MobileCard>
        )}
      </div>
    </div>
  )
}
```

Create `frontend/src/mobile/pages/dashboard/MobileUsagePage.tsx`:
```tsx
import { MobileCard } from '../../components/MobileCard'
import { useUsage } from '@/hooks/useUsage'

export function MobileUsagePage() {
  const { usage, isLoading } = useUsage()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Hạn ngạch & Mức sử dụng</h1>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải hạn ngạch...</div>
      ) : (
        <div className="space-y-3">
          <MobileCard className="space-y-3">
            <div className="flex justify-between items-center text-sm font-semibold">
              <span>Từ vựng AI dịch</span>
              <span>{usage?.wordsUsed ?? 0} / {usage?.wordsLimit ?? 500000}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.min(100, ((usage?.wordsUsed ?? 0) / (usage?.wordsLimit ?? 500000)) * 100)}%` }}
              />
            </div>
          </MobileCard>

          <MobileCard className="space-y-3">
            <div className="flex justify-between items-center text-sm font-semibold">
              <span>Thời lượng Video TTS</span>
              <span>{usage?.minutesUsed ?? 0} / {usage?.minutesLimit ?? 120} phút</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${Math.min(100, ((usage?.minutesUsed ?? 0) / (usage?.minutesLimit ?? 120)) * 100)}%` }}
              />
            </div>
          </MobileCard>

          <MobileCard className="space-y-3">
            <div className="flex justify-between items-center text-sm font-semibold">
              <span>Dung lượng lưu trữ</span>
              <span>{usage?.storageUsedGb ?? 0} / {usage?.storageLimitGb ?? 10} GB</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{ width: `${Math.min(100, ((usage?.storageUsedGb ?? 0) / (usage?.storageLimitGb ?? 10)) * 100)}%` }}
              />
            </div>
          </MobileCard>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/dashboard/MobileDashboardPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/dashboard/
git commit -m "feat(mobile): add mobile dashboard and usage pages"
```

---

### Task 4: Mobile Projects Page

**Files:**
- Create: `frontend/src/mobile/pages/projects/MobileProjectListPage.tsx`
- Test: `frontend/src/mobile/pages/projects/MobileProjectListPage.test.tsx`

**Interfaces:**
- Produces: `MobileProjectListPage()`
- Consumes: `@/hooks/useProjects`, `MobileCard`, `BottomSheet`, `MobileActionMenu`, `MobileSearchFilter`

- [ ] **Step 1: Write failing test for `MobileProjectListPage`**

Create `frontend/src/mobile/pages/projects/MobileProjectListPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileProjectListPage } from './MobileProjectListPage'

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({
    projects: [
      { id: 'p1', name: 'Website Localization', sourceLang: 'en', targetLangs: ['vi', 'ja'], progress: 65 },
    ],
    isLoading: false,
    createProject: vi.fn(),
    deleteProject: vi.fn(),
  }),
}))

describe('MobileProjectListPage', () => {
  it('renders project cards with progress and languages', () => {
    render(
      <MemoryRouter>
        <MobileProjectListPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Dự án')).toBeInTheDocument()
    expect(screen.getByText('Website Localization')).toBeInTheDocument()
    expect(screen.getByText('65%')).toBeInTheDocument()
  })

  it('opens create project sheet when Add button is clicked', () => {
    render(
      <MemoryRouter>
        <MobileProjectListPage />
      </MemoryRouter>
    )
    const addBtn = screen.getByLabelText('Tạo dự án mới')
    fireEvent.click(addBtn)
    expect(screen.getByText('Tạo dự án mới')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/projects/MobileProjectListPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileProjectListPage`**

Create `frontend/src/mobile/pages/projects/MobileProjectListPage.tsx`:
```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IconDotsVertical, IconFolder, IconPlus, IconTrash, IconEye } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileActionMenu } from '../../components/MobileActionMenu'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useProjects } from '@/hooks/useProjects'

export function MobileProjectListPage() {
  const { workspaceId } = useParams()
  const { projects, isLoading, createProject, deleteProject } = useProjects()
  const [search, setSearch] = useState('')
  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null)

  const filtered = (projects ?? []).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = () => {
    if (!newProjectName.trim()) return
    createProject({ name: newProjectName.trim() })
    setNewProjectName('')
    setCreateSheetOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Dự án</h1>
        <button
          type="button"
          onClick={() => setCreateSheetOpen(true)}
          aria-label="Tạo dự án mới"
          className="flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
        >
          <IconPlus size={16} />
          <span>Tạo mới</span>
        </button>
      </div>

      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm kiếm dự án..."
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải danh sách dự án...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconFolder size={36} />}
          title="Chưa có dự án nào"
          description="Bắt đầu tổ chức các tệp dịch thuật bằng cách tạo dự án đầu tiên."
          action={
            <button
              type="button"
              onClick={() => setCreateSheetOpen(true)}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white"
            >
              Tạo dự án
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((proj) => (
            <MobileCard key={proj.id} className="space-y-3">
              <div className="flex items-start justify-between">
                <Link
                  to={`/w/${workspaceId}/projects/${proj.id}/documents`}
                  className="font-semibold text-sm text-neutral-900 dark:text-white hover:text-primary transition-colors flex-1"
                >
                  {proj.name}
                </Link>
                <button
                  type="button"
                  onClick={() => setSelectedProject({ id: proj.id, name: proj.name })}
                  className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  <IconDotsVertical size={18} />
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span className="font-medium uppercase">{proj.sourceLang ?? 'en'}</span>
                <span>→</span>
                <div className="flex gap-1">
                  {(proj.targetLangs ?? []).map((lang: string) => (
                    <span key={lang} className="rounded-sm bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 uppercase">
                      {lang}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-500">
                  <span>Tiến độ</span>
                  <span className="font-semibold">{proj.progress ?? 0}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${proj.progress ?? 0}%` }}
                  />
                </div>
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      {/* Action Menu BottomSheet */}
      {selectedProject && (
        <MobileActionMenu
          isOpen={Boolean(selectedProject)}
          onClose={() => setSelectedProject(null)}
          title={selectedProject.name}
          actions={[
            {
              label: 'Xem tài liệu',
              icon: <IconEye size={18} />,
              onClick: () => {
                // Navigate via link
              },
            },
            {
              label: 'Xóa dự án',
              icon: <IconTrash size={18} />,
              danger: true,
              onClick: () => {
                deleteProject(selectedProject.id)
              },
            },
          ]}
        />
      )}

      {/* Create Project BottomSheet */}
      <BottomSheet
        isOpen={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        title="Tạo dự án mới"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Tên dự án</label>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="VD: Localization App 2026"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white active:scale-98 transition-transform"
          >
            Tạo dự án
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/projects/MobileProjectListPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/projects/
git commit -m "feat(mobile): add mobile project list page"
```

---

### Task 5: Mobile Batches Pages (List & Detail)

**Files:**
- Create: `frontend/src/mobile/pages/batches/MobileBatchListPage.tsx`
- Create: `frontend/src/mobile/pages/batches/MobileBatchDetailPage.tsx`
- Test: `frontend/src/mobile/pages/batches/MobileBatchListPage.test.tsx`

**Interfaces:**
- Produces: `MobileBatchListPage()`
- Produces: `MobileBatchDetailPage()`
- Consumes: `@/hooks/useBatches`, `MobileCard`, `MobileSearchFilter`, `MobileEmptyState`

- [ ] **Step 1: Write test for `MobileBatchListPage`**

Create `frontend/src/mobile/pages/batches/MobileBatchListPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileBatchListPage } from './MobileBatchListPage'

vi.mock('@/hooks/useBatches', () => ({
  useBatches: () => ({
    batches: [
      { id: 'b1', name: 'Batch Docs May', status: 'PROCESSING', progress: 45, totalFiles: 10, completedFiles: 4 },
    ],
    isLoading: false,
  }),
}))

describe('MobileBatchListPage', () => {
  it('renders batch list item with progress and status', () => {
    render(
      <MemoryRouter>
        <MobileBatchListPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Lô xử lý')).toBeInTheDocument()
    expect(screen.getByText('Batch Docs May')).toBeInTheDocument()
    expect(screen.getByText('45%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/batches/MobileBatchListPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileBatchListPage` and `MobileBatchDetailPage`**

Create `frontend/src/mobile/pages/batches/MobileBatchListPage.tsx`:
```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IconLayersLinked } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useBatches } from '@/hooks/useBatches'

export function MobileBatchListPage() {
  const { workspaceId } = useParams()
  const { batches, isLoading } = useBatches()
  const [search, setSearch] = useState('')

  const filtered = (batches ?? []).filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Lô xử lý (Batches)</h1>

      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm kiếm lô xử lý..."
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải lô xử lý...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconLayersLinked size={36} />}
          title="Chưa có lô xử lý nào"
          description="Các tệp được xử lý đồng thời sẽ hiển thị tại đây."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((b) => (
            <MobileCard key={b.id} className="space-y-3">
              <div className="flex items-start justify-between">
                <Link
                  to={`/w/${workspaceId}/batches/${b.id}`}
                  className="font-semibold text-sm text-neutral-900 dark:text-white hover:text-primary transition-colors flex-1"
                >
                  {b.name}
                </Link>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {b.status}
                </span>
              </div>

              <div className="flex justify-between text-xs text-neutral-500">
                <span>Số tệp: {b.completedFiles ?? 0}/{b.totalFiles ?? 0}</span>
                <span className="font-semibold">{b.progress ?? 0}%</span>
              </div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${b.progress ?? 0}%` }}
                />
              </div>
            </MobileCard>
          ))}
        </div>
      )}
    </div>
  )
}
```

Create `frontend/src/mobile/pages/batches/MobileBatchDetailPage.tsx`:
```tsx
import { useParams, Link } from 'react-router-dom'
import { IconArrowLeft, IconCheck, IconRefresh } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { useBatchDetail } from '@/hooks/useBatches'

export function MobileBatchDetailPage() {
  const { workspaceId, batchId } = useParams()
  const { batch, items, isLoading, rerunItem } = useBatchDetail(batchId)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to={`/w/${workspaceId}/batches`}
          className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <IconArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold text-neutral-900 dark:text-white line-clamp-1">
          {batch?.name ?? 'Chi tiết lô'}
        </h1>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải chi tiết lô...</div>
      ) : (
        <div className="space-y-3">
          <MobileCard className="space-y-2 bg-primary/5 dark:bg-primary/10 border-primary/20">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-neutral-600 dark:text-neutral-400">Trạng thái</span>
              <span className="font-bold text-primary">{batch?.status}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-neutral-600 dark:text-neutral-400">Tiến độ tổng thể</span>
              <span className="font-bold">{batch?.progress ?? 0}%</span>
            </div>
          </MobileCard>

          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Danh sách tệp trong lô</h2>
          <div className="space-y-2">
            {(items ?? []).map((item) => (
              <MobileCard key={item.id} className="flex items-center justify-between p-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium line-clamp-1">{item.name}</span>
                  <span className="text-[11px] text-neutral-500">{item.status}</span>
                </div>
                {item.status === 'FAILED' ? (
                  <button
                    type="button"
                    onClick={() => rerunItem?.(item.id)}
                    className="flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1.5 text-xs text-neutral-700 dark:text-neutral-300"
                  >
                    <IconRefresh size={14} />
                    <span>Thử lại</span>
                  </button>
                ) : (
                  <IconCheck size={18} className="text-emerald-500" />
                )}
              </MobileCard>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/batches/MobileBatchListPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/batches/
git commit -m "feat(mobile): add mobile batch list and detail pages"
```

---

### Task 6: Mobile Glossary Page

**Files:**
- Create: `frontend/src/mobile/pages/glossary/MobileGlossaryPage.tsx`
- Test: `frontend/src/mobile/pages/glossary/MobileGlossaryPage.test.tsx`

**Interfaces:**
- Produces: `MobileGlossaryPage()`
- Consumes: `@/hooks/useGlossary`, `MobileCard`, `BottomSheet`, `MobileSearchFilter`

- [ ] **Step 1: Write test for `MobileGlossaryPage`**

Create `frontend/src/mobile/pages/glossary/MobileGlossaryPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileGlossaryPage } from './MobileGlossaryPage'

vi.mock('@/hooks/useGlossary', () => ({
  useGlossaries: () => ({
    terms: [
      { id: 't1', source: 'Artificial Intelligence', target: 'Trí tuệ nhân tạo', context: 'Công nghệ' },
    ],
    isLoading: false,
    addTerm: vi.fn(),
    deleteTerm: vi.fn(),
  }),
}))

describe('MobileGlossaryPage', () => {
  it('renders glossary term pair cards', () => {
    render(
      <MemoryRouter>
        <MobileGlossaryPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Từ điển thuật ngữ')).toBeInTheDocument()
    expect(screen.getByText('Artificial Intelligence')).toBeInTheDocument()
    expect(screen.getByText('Trí tuệ nhân tạo')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/glossary/MobileGlossaryPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileGlossaryPage`**

Create `frontend/src/mobile/pages/glossary/MobileGlossaryPage.tsx`:
```tsx
import { useState } from 'react'
import { IconBook, IconPlus, IconTrash } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useGlossaries } from '@/hooks/useGlossary'

export function MobileGlossaryPage() {
  const { terms, isLoading, addTerm, deleteTerm } = useGlossaries()
  const [search, setSearch] = useState('')
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [context, setContext] = useState('')

  const filtered = (terms ?? []).filter(
    (t) =>
      t.source.toLowerCase().includes(search.toLowerCase()) ||
      t.target.toLowerCase().includes(search.toLowerCase())
  )

  const handleAdd = () => {
    if (!source.trim() || !target.trim()) return
    addTerm({ source: source.trim(), target: target.trim(), context: context.trim() })
    setSource('')
    setTarget('')
    setContext('')
    setAddSheetOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Từ điển thuật ngữ</h1>
        <button
          type="button"
          onClick={() => setAddSheetOpen(true)}
          className="flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
        >
          <IconPlus size={16} />
          <span>Thêm từ</span>
        </button>
      </div>

      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm thuật ngữ..."
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải thuật ngữ...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title="Chưa có thuật ngữ nào"
          description="Thêm cặp từ ngữ chuyên ngành để chuẩn hóa bản dịch tự động."
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((t) => (
            <MobileCard key={t.id} className="space-y-1.5 p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-0.5">
                  <div className="text-sm font-semibold text-neutral-900 dark:text-white">{t.source}</div>
                  <div className="text-xs font-medium text-primary">{t.target}</div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteTerm(t.id)}
                  className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                >
                  <IconTrash size={16} />
                </button>
              </div>
              {t.context && (
                <span className="inline-block rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500">
                  {t.context}
                </span>
              )}
            </MobileCard>
          ))}
        </div>
      )}

      {/* Add Term BottomSheet */}
      <BottomSheet
        isOpen={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="Thêm thuật ngữ mới"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Từ gốc (Source)</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="VD: machine learning"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Từ dịch (Target)</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="VD: học máy"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Ngữ cảnh / Ghi chú</label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="VD: Thuật ngữ CNTT"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white active:scale-98 transition-transform"
          >
            Lưu thuật ngữ
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/glossary/MobileGlossaryPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/glossary/
git commit -m "feat(mobile): add mobile glossary page"
```

---

### Task 7: Mobile Media Hub Page (with preserved Media Studio link)

**Files:**
- Create: `frontend/src/mobile/pages/media/MobileMediaListPage.tsx`
- Test: `frontend/src/mobile/pages/media/MobileMediaListPage.test.tsx`

**Interfaces:**
- Produces: `MobileMediaListPage()`
- Consumes: `@/hooks/useMedia`, `MobileCard`, `MobileSearchFilter`, `MobileEmptyState`
- Invariant check: Links directly to `/w/:workspaceId/media/jobs/:jobId` (Media Studio)

- [ ] **Step 1: Write test for `MobileMediaListPage`**

Create `frontend/src/mobile/pages/media/MobileMediaListPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileMediaListPage } from './MobileMediaListPage'

vi.mock('@/hooks/useMedia', () => ({
  useMediaJobs: () => ({
    jobs: [
      { id: 'job-123', title: 'Product Launch Video', status: 'COMPLETED', duration: '02:45', progress: 100 },
    ],
    isLoading: false,
  }),
}))

describe('MobileMediaListPage', () => {
  it('renders media card with direct link to Media Studio', () => {
    render(
      <MemoryRouter>
        <MobileMediaListPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Media Hub')).toBeInTheDocument()
    expect(screen.getByText('Product Launch Video')).toBeInTheDocument()
    expect(screen.getByText('02:45')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/media/MobileMediaListPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileMediaListPage`**

Create `frontend/src/mobile/pages/media/MobileMediaListPage.tsx`:
```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IconUpload, IconVideo } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useMediaJobs } from '@/hooks/useMedia'

export function MobileMediaListPage() {
  const { workspaceId } = useParams()
  const { jobs, isLoading } = useMediaJobs()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const filterOptions = [
    { id: 'ALL', label: 'Tất cả' },
    { id: 'PROCESSING', label: 'Đang xử lý' },
    { id: 'COMPLETED', label: 'Hoàn thành' },
    { id: 'FAILED', label: 'Thất bại' },
  ]

  const filtered = (jobs ?? []).filter((j) => {
    const matchSearch = j.title?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'ALL' || j.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Media Hub</h1>
        <Link
          to={`/w/${workspaceId}/media/presets`}
          className="rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
        >
          Presets
        </Link>
      </div>

      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm kiếm video/audio..."
        filters={filterOptions}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải danh sách media...</div>
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconVideo size={36} />}
          title="Chưa có tệp Media nào"
          description="Tải lên tệp video hoặc audio để bắt đầu quy trình phụ đề và lồng tiếng AI."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <Link
              key={item.id}
              to={`/w/${workspaceId}/media/jobs/${item.id}`}
              className="block"
            >
              <MobileCard interactive className="space-y-3">
                <div className="flex gap-3">
                  <div className="relative h-18 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center">
                    <IconVideo size={24} className="text-neutral-400" />
                    {item.duration && (
                      <span className="absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">
                        {item.duration}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                      {item.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {item.status}
                      </span>
                    </div>
                  </div>
                </div>

                {item.status === 'PROCESSING' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-neutral-500">
                      <span>Đang xử lý</span>
                      <span>{item.progress ?? 0}%</span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${item.progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </MobileCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/media/MobileMediaListPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/media/
git commit -m "feat(mobile): add mobile media list page with direct links to media studio"
```

---

### Task 8: Mobile Settings Pages (Members & Presets)

**Files:**
- Create: `frontend/src/mobile/pages/settings/MobileMembersPage.tsx`
- Create: `frontend/src/mobile/pages/settings/MobilePresetSettingsPage.tsx`
- Test: `frontend/src/mobile/pages/settings/MobileMembersPage.test.tsx`

**Interfaces:**
- Produces: `MobileMembersPage()`
- Produces: `MobilePresetSettingsPage()`
- Consumes: `@/hooks/useMembers`, `@/hooks/useWorkflowPresets`, `MobileCard`, `BottomSheet`

- [ ] **Step 1: Write test for `MobileMembersPage`**

Create `frontend/src/mobile/pages/settings/MobileMembersPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileMembersPage } from './MobileMembersPage'

vi.mock('@/hooks/useMembers', () => ({
  useMembers: () => ({
    members: [
      { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
    ],
    isLoading: false,
    inviteMember: vi.fn(),
  }),
}))

describe('MobileMembersPage', () => {
  it('renders member cards with roles', () => {
    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )
    expect(screen.getByText('Thành viên Workspace')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/settings/MobileMembersPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileMembersPage` and `MobilePresetSettingsPage`**

Create `frontend/src/mobile/pages/settings/MobileMembersPage.tsx`:
```tsx
import { useState } from 'react'
import { IconPlus, IconUser, IconUsers } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useMembers } from '@/hooks/useMembers'

export function MobileMembersPage() {
  const { members, isLoading, inviteMember } = useMembers()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('MEMBER')

  const handleInvite = () => {
    if (!email.trim()) return
    inviteMember({ email: email.trim(), role })
    setEmail('')
    setInviteOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Thành viên Workspace</h1>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
        >
          <IconPlus size={16} />
          <span>Mời</span>
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải danh sách thành viên...</div>
      ) : (members ?? []).length === 0 ? (
        <MobileEmptyState
          icon={<IconUsers size={36} />}
          title="Chưa có thành viên nào"
        />
      ) : (
        <div className="space-y-2.5">
          {(members ?? []).map((m) => (
            <MobileCard key={m.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-semibold text-sm">
                  {m.name?.[0] ?? <IconUser size={16} />}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white">{m.name}</span>
                  <span className="text-xs text-neutral-500">{m.email}</span>
                </div>
              </div>
              <span className="rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-700 dark:text-neutral-300">
                {m.role}
              </span>
            </MobileCard>
          ))}
        </div>
      )}

      {/* Invite Member BottomSheet */}
      <BottomSheet
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Mời thành viên mới"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Email thành viên</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Vai trò</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900"
            >
              <option value="MEMBER">Member (Thành viên)</option>
              <option value="ADMIN">Admin (Quản trị viên)</option>
              <option value="TRANSLATOR">Translator (Biên dịch viên)</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleInvite}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white active:scale-98 transition-transform"
          >
            Gửi lời mời
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
```

Create `frontend/src/mobile/pages/settings/MobilePresetSettingsPage.tsx`:
```tsx
import { MobileCard } from '../../components/MobileCard'
import { useWorkflowPresets } from '@/hooks/useWorkflowPresets'

export function MobilePresetSettingsPage() {
  const { presets, isLoading } = useWorkflowPresets()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Workflow Presets</h1>
      <p className="text-xs text-neutral-500">Cấu hình mẫu cho pipeline dịch thuật và TTS video.</p>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải presets...</div>
      ) : (
        <div className="space-y-3">
          {(presets ?? []).map((preset) => (
            <MobileCard key={preset.id} className="space-y-2 p-3">
              <div className="flex justify-between items-start">
                <span className="font-semibold text-sm text-neutral-900 dark:text-white">{preset.name}</span>
                <span className="rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] font-medium">
                  {preset.isSystem ? 'Hệ thống' : 'Tùy chỉnh'}
                </span>
              </div>
              <p className="text-xs text-neutral-500 line-clamp-2">{preset.description}</p>
            </MobileCard>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/settings/MobileMembersPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/settings/
git commit -m "feat(mobile): add mobile members and preset settings pages"
```

---

### Task 9: Mobile Account & Notification Pages

**Files:**
- Create: `frontend/src/mobile/pages/account/MobileAccountPage.tsx`
- Create: `frontend/src/mobile/pages/notification/MobileNotificationPage.tsx`
- Test: `frontend/src/mobile/pages/account/MobileAccountPage.test.tsx`

**Interfaces:**
- Produces: `MobileAccountPage()`
- Produces: `MobileNotificationPage()`
- Consumes: `@/store/authStore`, `@/hooks/useNotifications`, `MobileCard`

- [ ] **Step 1: Write test for `MobileAccountPage`**

Create `frontend/src/mobile/pages/account/MobileAccountPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileAccountPage } from './MobileAccountPage'

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
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/pages/account/MobileAccountPage.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileAccountPage` and `MobileNotificationPage`**

Create `frontend/src/mobile/pages/account/MobileAccountPage.tsx`:
```tsx
import { useAuthStore } from '@/store/authStore'
import { MobileCard } from '../../components/MobileCard'
import { IconChevronRight, IconLock, IconUser, IconBell, IconLogout } from '@tabler/icons-react'

export function MobileAccountPage() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Cài đặt tài khoản</h1>

      <MobileCard className="flex items-center gap-3 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary text-lg font-bold">
          {user?.name?.[0] ?? 'U'}
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-neutral-900 dark:text-white">{user?.name ?? 'Người dùng'}</span>
          <span className="text-xs text-neutral-500">{user?.email ?? ''}</span>
        </div>
      </MobileCard>

      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Cài đặt</h2>
        <MobileCard className="divide-y divide-neutral-100 dark:divide-neutral-800 p-0 overflow-hidden">
          <div className="flex items-center justify-between p-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer">
            <div className="flex items-center gap-3">
              <IconUser size={18} className="text-neutral-500" />
              <span className="text-sm font-medium">Hồ sơ cá nhân</span>
            </div>
            <IconChevronRight size={16} className="text-neutral-400" />
          </div>
          <div className="flex items-center justify-between p-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer">
            <div className="flex items-center gap-3">
              <IconLock size={18} className="text-neutral-500" />
              <span className="text-sm font-medium">Bảo mật & Mật khẩu</span>
            </div>
            <IconChevronRight size={16} className="text-neutral-400" />
          </div>
          <div className="flex items-center justify-between p-3.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 cursor-pointer">
            <div className="flex items-center gap-3">
              <IconBell size={18} className="text-neutral-500" />
              <span className="text-sm font-medium">Tùy chọn thông báo</span>
            </div>
            <IconChevronRight size={16} className="text-neutral-400" />
          </div>
        </MobileCard>
      </div>

      <button
        type="button"
        onClick={() => logout()}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 p-3 text-sm font-semibold text-red-600 dark:text-red-400 active:bg-red-50 dark:active:bg-red-950/30 transition-colors"
      >
        <IconLogout size={18} />
        <span>Đăng xuất</span>
      </button>
    </div>
  )
}
```

Create `frontend/src/mobile/pages/notification/MobileNotificationPage.tsx`:
```tsx
import { IconBell, IconCheck } from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useNotifications } from '@/hooks/useNotifications'

export function MobileNotificationPage() {
  const { notifications, isLoading, markAllAsRead } = useNotifications()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Thông báo</h1>
        <button
          type="button"
          onClick={() => markAllAsRead?.()}
          className="flex items-center gap-1 text-xs font-semibold text-primary"
        >
          <IconCheck size={14} />
          <span>Đọc tất cả</span>
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải thông báo...</div>
      ) : (notifications ?? []).length === 0 ? (
        <MobileEmptyState
          icon={<IconBell size={36} />}
          title="Không có thông báo mới"
          description="Bạn sẽ nhận được thông báo khi tiến trình dịch hoặc media hoàn tất."
        />
      ) : (
        <div className="space-y-2">
          {(notifications ?? []).map((n) => (
            <MobileCard key={n.id} className="space-y-1 p-3">
              <div className="flex items-start justify-between">
                <span className="text-sm font-semibold">{n.title}</span>
                <span className="text-[10px] text-neutral-400">{n.time}</span>
              </div>
              <p className="text-xs text-neutral-500">{n.message}</p>
            </MobileCard>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/mobile/pages/account/MobileAccountPage.test.tsx --run`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/mobile/pages/account/ frontend/src/mobile/pages/notification/
git commit -m "feat(mobile): add mobile account and notification pages"
```

---

### Task 10: Adaptive Integration with Strict Media Studio Exemption & End-to-End Verification

**Files:**
- Create: `frontend/src/mobile/routes/MobileWorkspaceAdapter.tsx`
- Modify: `frontend/src/app/router.tsx:87-217` (Mount adapter cleanly at the workspace route level)
- Test: `frontend/src/mobile/routes/MobileWorkspaceAdapter.test.tsx`

**Interfaces:**
- Produces: `MobileWorkspaceAdapter()`
- Invariant: When path matches `media/jobs/:jobId`, render original desktop `MediaJobPage` directly without altering its layout.
- When viewport is mobile (< 768px), render `MobileAppShell` with the corresponding mobile page.
- When viewport is desktop (>= 768px), render existing `AppShell` with existing desktop pages.

- [ ] **Step 1: Write test for `MobileWorkspaceAdapter`**

Create `frontend/src/mobile/routes/MobileWorkspaceAdapter.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileWorkspaceAdapter } from './MobileWorkspaceAdapter'

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}))

import { useIsMobile } from '../hooks/useIsMobile'

describe('MobileWorkspaceAdapter', () => {
  it('renders desktop AppShell when useIsMobile returns false', () => {
    vi.mocked(useIsMobile).mockReturnValue(false)
    render(
      <MemoryRouter initialEntries={['/w/w1']}>
        <Routes>
          <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
        </Routes>
      </MemoryRouter>
    )
    // Desktop AppShell has app-shell class
    expect(document.querySelector('.app-shell')).toBeInTheDocument()
  })

  it('renders MobileAppShell when useIsMobile returns true', () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    render(
      <MemoryRouter initialEntries={['/w/w1']}>
        <Routes>
          <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Menu')).toBeInTheDocument()
  })

  it('renders original MediaJobPage directly even when useIsMobile is true', () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    render(
      <MemoryRouter initialEntries={['/w/w1/media/jobs/job-999']}>
        <Routes>
          <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
        </Routes>
      </MemoryRouter>
    )
    // Media studio route should not render MobileBottomNav
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/mobile/routes/MobileWorkspaceAdapter.test.tsx --run`
Expected: FAIL.

- [ ] **Step 3: Implement `MobileWorkspaceAdapter` and wire into `frontend/src/app/router.tsx`**

Create `frontend/src/mobile/routes/MobileWorkspaceAdapter.tsx`:
```tsx
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useIsMobile } from '../hooks/useIsMobile'
import { AppShell } from '@/components/layout/AppShell'
import { MobileAppShell } from '../layout/MobileAppShell'
import { RouteErrorBoundary } from '@/components/error/RouteErrorBoundary'
import { RoleGuard } from '@/components/auth/RoleGuard'

// Desktop pages (lazy loaded)
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const UsagePage = lazy(() => import('@/pages/dashboard/UsagePage').then(m => ({ default: m.UsagePage })))
const MediaListPage = lazy(() => import('@/pages/media/MediaListPage').then(m => ({ default: m.MediaListPage })))
const MediaJobPage = lazy(() => import('@/pages/media/MediaJobPage').then(m => ({ default: m.MediaJobPage })))
const MembersPage = lazy(() => import('@/pages/settings/MembersPage').then(m => ({ default: m.MembersPage })))
const PresetSettingsPage = lazy(() => import('@/pages/settings/PresetSettingsPage').then(m => ({ default: m.PresetSettingsPage })))
const AccountSettingsPage = lazy(() => import('@/pages/account/AccountSettingsPage').then(m => ({ default: m.AccountSettingsPage })))
const BatchListPage = lazy(() => import('@/pages/batch/BatchListPage').then(m => ({ default: m.BatchListPage })))
const BatchDetailPage = lazy(() => import('@/pages/batch/BatchDetailPage').then(m => ({ default: m.BatchDetailPage })))
const ProjectListPage = lazy(() => import('@/pages/project/ProjectListPage').then(m => ({ default: m.ProjectListPage })))
const NotificationCenterPage = lazy(() => import('@/pages/notification/NotificationCenterPage').then(m => ({ default: m.NotificationCenterPage })))
const GlossaryPage = lazy(() => import('@/pages/glossary/GlossaryPage').then(m => ({ default: m.GlossaryPage })))

// Mobile pages (lazy loaded)
const MobileDashboardPage = lazy(() => import('../pages/dashboard/MobileDashboardPage').then(m => ({ default: m.MobileDashboardPage })))
const MobileUsagePage = lazy(() => import('../pages/dashboard/MobileUsagePage').then(m => ({ default: m.MobileUsagePage })))
const MobileProjectListPage = lazy(() => import('../pages/projects/MobileProjectListPage').then(m => ({ default: m.MobileProjectListPage })))
const MobileBatchListPage = lazy(() => import('../pages/batches/MobileBatchListPage').then(m => ({ default: m.MobileBatchListPage })))
const MobileBatchDetailPage = lazy(() => import('../pages/batches/MobileBatchDetailPage').then(m => ({ default: m.MobileBatchDetailPage })))
const MobileGlossaryPage = lazy(() => import('../pages/glossary/MobileGlossaryPage').then(m => ({ default: m.MobileGlossaryPage })))
const MobileMediaListPage = lazy(() => import('../pages/media/MobileMediaListPage').then(m => ({ default: m.MobileMediaListPage })))
const MobileMembersPage = lazy(() => import('../pages/settings/MobileMembersPage').then(m => ({ default: m.MobileMembersPage })))
const MobilePresetSettingsPage = lazy(() => import('../pages/settings/MobilePresetSettingsPage').then(m => ({ default: m.MobilePresetSettingsPage })))
const MobileAccountPage = lazy(() => import('../pages/account/MobileAccountPage').then(m => ({ default: m.MobileAccountPage })))
const MobileNotificationPage = lazy(() => import('../pages/notification/MobileNotificationPage').then(m => ({ default: m.MobileNotificationPage })))

export function MobileWorkspaceAdapter() {
  const { workspaceId } = useParams()
  const isMobile = useIsMobile()
  const location = useLocation()

  // SPECIAL EXEMPTION: Media Studio Job detail page is ALWAYS rendered as original MediaJobPage as-is
  const isMediaStudioJobDetail = /\/media\/jobs\/[^/]+/.test(location.pathname)

  if (isMediaStudioJobDetail) {
    return (
      <RouteErrorBoundary workspaceId={workspaceId}>
        <AppShell>
          <MediaJobPage />
        </AppShell>
      </RouteErrorBoundary>
    )
  }

  if (isMobile) {
    return (
      <RouteErrorBoundary workspaceId={workspaceId}>
        <Routes>
          <Route element={<MobileAppShell />}>
            <Route index element={<MobileDashboardPage />} />
            <Route path="notifications" element={<MobileNotificationPage />} />
            <Route path="projects" element={<MobileProjectListPage />} />
            <Route path="projects/:projectId/documents" element={<Navigate to="../media" replace />} />
            <Route path="documents/:documentId/jobs" element={<Navigate to="../media" replace />} />
            <Route path="jobs/:jobId/editor" element={<Navigate to="../media" replace />} />
            <Route path="batches" element={<MobileBatchListPage />} />
            <Route path="batches/:batchId" element={<MobileBatchDetailPage />} />
            <Route path="glossaries" element={<MobileGlossaryPage />} />
            <Route path="tm" element={<Navigate to="../glossaries" replace />} />
            <Route path="media" element={<MobileMediaListPage />} />
            <Route path="media/presets" element={<MobilePresetSettingsPage />} />
            <Route path="dashboard/usage" element={<MobileUsagePage />} />
            <Route path="settings/members" element={<MobileMembersPage />} />
            <Route path="settings/provider" element={<Navigate to="../account/security" replace />} />
            <Route path="settings/media-presets" element={<Navigate to="../media/presets" replace />} />
            <Route path="account/*" element={<MobileAccountPage />} />
            <Route path="*" element={<Navigate to="" replace />} />
          </Route>
        </Routes>
      </RouteErrorBoundary>
    )
  }

  // Desktop View: Original AppShell & Desktop pages untouched
  return (
    <RouteErrorBoundary workspaceId={workspaceId}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="notifications" element={<NotificationCenterPage />} />
          <Route path="projects" element={<ProjectListPage />} />
          <Route path="projects/:projectId/documents" element={<Navigate to="../media" replace />} />
          <Route path="documents/:documentId/jobs" element={<Navigate to="../media" replace />} />
          <Route path="jobs/:jobId/editor" element={<Navigate to="../media" replace />} />
          <Route path="batches" element={<BatchListPage />} />
          <Route path="batches/:batchId" element={<BatchDetailPage />} />
          <Route path="glossaries" element={<GlossaryPage />} />
          <Route path="tm" element={<Navigate to="../glossaries" replace />} />
          <Route path="media" element={<MediaListPage />} />
          <Route path="media/presets" element={<PresetSettingsPage />} />
          <Route path="media/jobs/:jobId" element={<MediaJobPage />} />
          <Route
            path="dashboard/usage"
            element={
              <RoleGuard action="dashboard.usage">
                <UsagePage />
              </RoleGuard>
            }
          />
          <Route path="settings/members" element={<MembersPage />} />
          <Route path="settings/provider" element={<Navigate to="../account/security" replace />} />
          <Route path="settings/media-presets" element={<Navigate to="../media/presets" replace />} />
          <Route path="account/:section" element={<AccountSettingsPage />} />
          <Route path="account" element={<Navigate to="profile" replace />} />
        </Route>
      </Routes>
    </RouteErrorBoundary>
  )
}
```

In `frontend/src/app/router.tsx`:
Mount `MobileWorkspaceAdapter` for `/w/:workspaceId/*`:
```tsx
<Route element={<AuthGuard />}>
  <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
</Route>
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test -- --run`
Expected: All tests pass.

- [ ] **Step 5: Run linter and typecheck**

Run: `npm run build`
Expected: Clean build without errors.

- [ ] **Step 6: Commit changes**

```bash
git add frontend/src/mobile/routes/ frontend/src/app/router.tsx
git commit -m "feat(mobile): integrate MobileWorkspaceAdapter with strict media studio exemption"
```
