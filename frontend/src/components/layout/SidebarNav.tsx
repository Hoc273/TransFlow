import type { ComponentType } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconBook2,
  IconChartBar,
  IconCoins,
  IconFolder,
  IconLayoutGrid,
  IconShieldCheck,
  IconUsers,
  IconVideo,
} from '@tabler/icons-react'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { usePermission } from '@/hooks/usePermission'
import { useUserCredit } from '@/hooks/useCredit'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { PermissionAction } from '@/lib/permissions'

type NavItem = {
  key: string
  labelKey: string
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>
  path?: string
  badge?: string
  disabled?: boolean
  tooltipKey?: string
  /** When set, item is hidden unless permission grants (09b A.5.3). */
  permission?: PermissionAction
}

type NavGroup = {
  titleKey: string
  items: NavItem[]
}

function buildGroups(workspaceId: string): NavGroup[] {
  const base = `/w/${workspaceId}`
  return [
    {
      titleKey: 'nav.overview',
      items: [
        { key: 'dashboard', labelKey: 'nav.dashboard', icon: IconLayoutGrid, path: base },
      ],
    },
    {
      titleKey: 'nav.workspace',
      items: [
        { key: 'projects', labelKey: 'nav.projects', icon: IconFolder, path: `${base}/projects` },
        {
          key: 'glossaries',
          labelKey: 'nav.glossaries',
          icon: IconBook2,
          path: `${base}/glossaries`,
        },
      ],
    },
    {
      titleKey: 'nav.studios',
      items: [
        {
          key: 'media',
          labelKey: 'nav.media',
          icon: IconVideo,
          path: `${base}/media`,
        },
      ],
    },
    {
      titleKey: 'nav.system',
      items: [
        {
          key: 'usage',
          labelKey: 'nav.usage',
          icon: IconChartBar,
          path: `${base}/dashboard/usage`,
          permission: 'dashboard.usage',
        },
        {
          key: 'members',
          labelKey: 'nav.members',
          icon: IconUsers,
          path: `${base}/settings/members`,
        },
      ],
    },
  ]
}

interface SidebarNavProps {
  mobileOpen?: boolean
  className?: string
}

export function SidebarNav({ mobileOpen, className }: SidebarNavProps) {
  const { t } = useTranslation(['common', 'account'])
  const { workspaceId = '' } = useParams()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const language = useUiStore((s) => s.language)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)
  const canUsage = usePermission('dashboard.usage')
  const isPlatformAdmin = useAuthStore((s) => s.user?.isPlatformAdmin === true)
  const { data: creditData, isLoading: isCreditLoading } = useUserCredit()
  const groups = buildGroups(workspaceId)

  const balanceValue = Number(creditData?.balance ?? 0)
  const activeWsId = workspaceId || currentWorkspace?.id || ''
  const creditPath = activeWsId ? `/w/${activeWsId}/account/credit` : '/dashboard'

  const allowed = (item: NavItem) => {
    if (!item.permission) return true
    if (item.permission === 'dashboard.usage') return canUsage
    return true
  }

  return (
    <aside
      className={cn(
        'app-sidebar',
        collapsed && 'collapsed',
        mobileOpen && 'mobile-open',
        className,
      )}
    >
      <WorkspaceSwitcher />

      <nav className="flex-1 pb-4">
        {groups.map((group) => (
          <div key={group.titleKey} className="nav-group">
            <div className="nav-group-title">{t(group.titleKey)}</div>
            {group.items.filter(allowed).map((item) => {
              const Icon = item.icon
              if (item.disabled || !item.path) {
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="nav-item disabled"
                    disabled
                    title={item.tooltipKey ? t(item.tooltipKey) : undefined}
                  >
                    <Icon size={18} stroke={1.75} className="shrink-0" />
                    <span className="nav-label">{t(item.labelKey)}</span>
                    {item.badge && <span className="phase-badge">{item.badge}</span>}
                  </button>
                )
              }

              const end = item.key === 'dashboard'
              return (
                <NavLink
                  key={item.key}
                  to={item.path}
                  end={end}
                  className={({ isActive }) => cn('nav-item', isActive && 'active')}
                  title={item.tooltipKey ? t(item.tooltipKey) : undefined}
                >
                  <Icon size={18} stroke={1.75} className="shrink-0" />
                  <span className="nav-label">{t(item.labelKey)}</span>
                  {item.badge && <span className="phase-badge">{item.badge}</span>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      {isPlatformAdmin && (
        <div className="px-4 pb-2">
          <NavLink to="/platform" className={({ isActive }) => cn('nav-item', isActive && 'active')}>
            <IconShieldCheck size={18} stroke={1.75} className="shrink-0" />
            <span className="nav-label">Platform Admin</span>
          </NavLink>
        </div>
      )}

      <Link
        to={creditPath}
        className={cn(
          'mt-auto border-t border-[var(--color-border)] p-3 text-inherit no-underline transition-colors hover:bg-[var(--color-bg-hover)] block',
          collapsed && 'flex justify-center p-2',
        )}
        title={
          collapsed
            ? `${t('common:creditBalance', { defaultValue: 'Số dư credit' })}: ${formatNumber(balanceValue, language)} ${t('account:credit.unit', { defaultValue: 'credit' })}`
            : undefined
        }
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <IconCoins size={18} stroke={1.75} />
          </div>
          <div className="sidebar-footer-text min-w-0 flex-1">
            <div className="text-[10px] font-medium tracking-wide text-[var(--color-text-tertiary)] uppercase">
              {t('common:creditBalance', { defaultValue: 'Số dư credit' })}
            </div>
            <div className="text-xs font-semibold text-[var(--color-accent)]">
              {isCreditLoading ? (
                <span className="font-normal text-[var(--color-text-tertiary)]">…</span>
              ) : (
                <span>
                  {formatNumber(balanceValue, language)}{' '}
                  <span className="text-[10px] font-normal text-[var(--color-text-secondary)]">
                    {t('account:credit.unit', { defaultValue: 'credit' })}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </aside>
  )
}
