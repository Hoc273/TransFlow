import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconActivity,
  IconBuilding,
  IconClipboardList,
  IconInfoCircle,
  IconLanguage,
  IconLayoutDashboard,
  IconLogout,
  IconShieldCheck,
  IconUsers,
  IconArrowLeft,
} from '@tabler/icons-react'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { RouteErrorBoundary } from '@/components/error/RouteErrorBoundary'
import { usePlatformStatus } from '@/hooks/usePlatform'
import { useLogout } from '@/hooks/useAuth'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'
import { initialsFromName } from '@/lib/format'

const NAV = [
  { to: '/platform', end: true, icon: IconLayoutDashboard, key: 'overview' as const },
  { to: '/platform/status', end: false, icon: IconActivity, key: 'status' as const },
  { to: '/platform/users', end: false, icon: IconUsers, key: 'users' as const },
  { to: '/platform/workspaces', end: false, icon: IconBuilding, key: 'workspaces' as const },
  { to: '/platform/audit', end: false, icon: IconClipboardList, key: 'audit' as const },
]

/** Separate shell for Super Admin — no workspace switcher (09b P.0 / docs/34 §5.3).
 *  Visual language from `frontend_design_by_qwen/super_admin_page.html`. */
export function PlatformShell() {
  const { t } = useTranslation('platform')
  const user = useAuthStore((s) => s.user)
  const currentWorkspaceId = useAuthStore((s) => s.currentWorkspace?.id)
  const { data: status } = usePlatformStatus()
  const logout = useLogout()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const overall = status?.overall ?? null
  const upCount = status?.services?.filter((s) => s.status === 'UP').length
  const totalSvc = status?.services?.length
  const name = user?.fullName ?? 'Admin'
  const email = user?.email ?? ''
  const initials = user ? initialsFromName(user.fullName) : 'SA'
  const workspaceId = currentWorkspaceId ?? getLastWorkspaceId()
  const workspacePath = workspaceId ? `/w/${workspaceId}` : '/no-workspace'

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div className="platform-shell">
      {/* Top bar — design template header; logo aligned with dashboard TopNav */}
      <header className="platform-topbar">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-2 text-[var(--color-accent)]">
            <IconLanguage size={20} stroke={1.75} aria-hidden />
            <div className="leading-tight">
              <div className="text-[15px] font-bold tracking-tight text-[var(--color-text-primary)]">
                TransFlow
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {t('brand.subtitle')}
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-1.5 border-l border-[var(--color-border)] pl-4 text-xs text-[var(--color-text-secondary)] md:flex">
            <IconShieldCheck size={14} className="text-[var(--color-accent)]" />
            <span className="font-medium text-[var(--color-text-primary)]">Platform</span>
            <span>·</span>
            <span>{t('topbar.superAdmin')}</span>
            <span>·</span>
            <span className="platform-badge-readonly">{t('topbar.readonly')}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle className="h-8 w-8 rounded-lg" />
          <div className="relative pl-1" ref={menuRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition hover:bg-[var(--color-bg-hover)]"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <div className="hidden text-right leading-tight md:block">
                <div className="text-xs font-semibold">{name}</div>
                <div className="text-[10px] text-[var(--color-text-tertiary)]">{t('topbar.role')}</div>
              </div>
              <div className="platform-avatar" aria-hidden>
                {initials}
              </div>
            </button>
            {menuOpen && (
              <div className="platform-user-menu" role="menu">
                <div className="border-b border-[var(--color-border)] px-3 py-2.5">
                  <div className="text-[13px] font-semibold">{name}</div>
                  {email && (
                    <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">
                      {email}
                    </div>
                  )}
                </div>
                <Link
                  to={workspacePath}
                  className="platform-user-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  <IconArrowLeft size={15} />
                  {t('backToApp')}
                </Link>
                <div className="border-t border-[var(--color-border)]" />
                <button
                  type="button"
                  className="platform-user-menu-item"
                  role="menuitem"
                  style={{ color: 'var(--destructive)' }}
                  onClick={() => {
                    setMenuOpen(false)
                    logout()
                  }}
                >
                  <IconLogout size={15} />
                  {t('topbar.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="platform-body">
        {/* Sidebar */}
        <aside className="platform-sidebar">
          <div className="flex flex-1 flex-col p-4">
            <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">
              {t('sidebar.console')}
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    ['platform-nav-item', isActive ? 'active' : ''].join(' ')
                  }
                >
                  <item.icon size={16} stroke={1.75} />
                  {t(`nav.${item.key}`)}
                </NavLink>
              ))}
            </nav>

            {/* Live health insight — real probe data only (no fake uptime %) */}
            <div className="mt-6">
              <div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">
                {t('sidebar.insights')}
              </div>
              <div className="rounded-lg platform-health-insight px-3 py-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={[
                      'platform-dot-pulse',
                      overall === 'UP'
                        ? 'platform-dot-success'
                        : overall === 'DEGRADED'
                          ? 'platform-dot-warning'
                          : 'platform-dot-muted',
                    ].join(' ')}
                  />
                  <span className="text-[11px] font-semibold">{t('sidebar.platformHealth')}</span>
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {overall ? (
                    <span
                      className={
                        overall === 'UP'
                          ? 'platform-hint-success'
                          : overall === 'DEGRADED'
                            ? 'text-[var(--color-status-partial)]'
                            : 'platform-hint-destructive'
                      }
                    >
                      {overall}
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-tertiary)]">—</span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
                  {upCount != null && totalSvc != null
                    ? t('sidebar.servicesUp', { up: upCount, total: totalSvc })
                    : t('sidebar.privacyNote')}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] p-4">
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
              <IconInfoCircle size={12} />
              <span>{t('sidebar.privacyNote')}</span>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile nav strip */}
          <nav className="platform-mobile-nav">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium',
                    isActive
                      ? 'bg-[var(--color-bg-active)] text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)]',
                  ].join(' ')
                }
              >
                {t(`nav.${item.key}`)}
              </NavLink>
            ))}
          </nav>

          <main className="platform-main">
            <RouteErrorBoundary>
              <Outlet />
            </RouteErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  )
}
