import type { ReactNode } from 'react'
import { NavLink, Navigate, useParams } from 'react-router-dom'
import {
  IconAdjustments,
  IconBuilding,
  IconChevronRight,
  IconCoins,
  IconShieldLock,
  IconUser,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/cn'
import { ProfileSection } from './sections/ProfileSection'
import { SecuritySection } from './sections/SecuritySection'
import { PreferencesSection } from './sections/PreferencesSection'
import { WorkspacesSection } from './sections/WorkspacesSection'
import { CreditSection } from './sections/CreditSection'

const SECTIONS = ['profile', 'security', 'preferences', 'credit', 'workspaces'] as const
export type AccountSection = (typeof SECTIONS)[number]

function isSection(s: string | undefined): s is AccountSection {
  return !!s && (SECTIONS as readonly string[]).includes(s)
}

/**
 * User-level Account Settings (Profile and Setting.html template).
 * Routes: /w/:workspaceId/account/:section
 * Distinct from workspace settings (members / providers).
 */
export function AccountSettingsPage() {
  const { t } = useTranslation(['account', 'common'])
  const { workspaceId = '', section } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const { data: workspaces = [] } = useWorkspaces()
  useDocumentTitle(t('account:page.title'))

  if (!isSection(section)) {
    return <Navigate to={`/w/${workspaceId}/account/profile`} replace />
  }

  const base = `/w/${workspaceId}/account`

  return (
    <div className="account-layout">
      <aside className="account-nav">
        <div className="breadcrumb">
          <span>{workspaceName || t('common:workspace.demoName')}</span>
          <IconChevronRight size={10} />
          <span>{t('account:nav.settings')}</span>
        </div>
        <h1 className="page-title mb-1">{t('account:page.title')}</h1>
        <p className="page-subtitle mb-6">{t('account:page.subtitle')}</p>

        <div className="account-nav-section">
          <div className="account-nav-section-title">{t('account:nav.account')}</div>
          <AccountNavLink to={`${base}/profile`} icon={<IconUser size={17} />} end>
            {t('account:nav.profile')}
          </AccountNavLink>
          <AccountNavLink to={`${base}/security`} icon={<IconShieldLock size={17} />}>
            {t('account:nav.security')}
          </AccountNavLink>
          <AccountNavLink to={`${base}/preferences`} icon={<IconAdjustments size={17} />}>
            {t('account:nav.preferences')}
          </AccountNavLink>
          <AccountNavLink to={`${base}/credit`} icon={<IconCoins size={17} />}>
            {t('account:nav.credit')}
          </AccountNavLink>
        </div>

        <div className="account-nav-section">
          <div className="account-nav-section-title">{t('account:nav.memberships')}</div>
          <AccountNavLink
            to={`${base}/workspaces`}
            icon={<IconBuilding size={17} />}
            trailing={
              workspaces.length > 0 ? (
                <span className="account-nav-count">{workspaces.length}</span>
              ) : undefined
            }
          >
            {t('account:nav.myWorkspaces')}
          </AccountNavLink>
        </div>
      </aside>

      <main className="account-main">
        {section === 'profile' && <ProfileSection />}
        {section === 'security' && <SecuritySection />}
        {section === 'preferences' && <PreferencesSection />}
        {section === 'credit' && <CreditSection />}
        {section === 'workspaces' && <WorkspacesSection />}
      </main>
    </div>
  )
}

function AccountNavLink({
  to,
  icon,
  children,
  trailing,
  className,
  end,
}: {
  to: string
  icon: ReactNode
  children: ReactNode
  trailing?: ReactNode
  className?: string
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn('account-nav-item', isActive && 'active', className)}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {trailing}
    </NavLink>
  )
}
