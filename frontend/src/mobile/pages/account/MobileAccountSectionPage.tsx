import { Link, Navigate, useParams } from 'react-router-dom'
import { IconChevronLeft } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { ProfileSection } from '@/pages/account/sections/ProfileSection'
import { SecuritySection } from '@/pages/account/sections/SecuritySection'
import { ApiKeysSection } from '@/pages/account/sections/ApiKeysSection'
import { PreferencesSection } from '@/pages/account/sections/PreferencesSection'
import { CreditSection } from '@/pages/account/sections/CreditSection'
import { WorkspacesSection } from '@/pages/account/sections/WorkspacesSection'

const SECTIONS = {
  profile: { titleKey: 'account:nav.profile', Component: ProfileSection },
  security: { titleKey: 'account:nav.security', Component: SecuritySection },
  'api-keys': { titleKey: 'account:nav.apiKeys', Component: ApiKeysSection },
  preferences: { titleKey: 'account:nav.preferences', Component: PreferencesSection },
  credit: { titleKey: 'account:nav.credit', Component: CreditSection },
  workspaces: { titleKey: 'account:nav.myWorkspaces', Component: WorkspacesSection },
} as const

type SectionKey = keyof typeof SECTIONS

function isSection(s: string | undefined): s is SectionKey {
  return !!s && Object.prototype.hasOwnProperty.call(SECTIONS, s)
}

/**
 * Mobile account sub-page (/w/:workspaceId/account/:section). Reuses the desktop
 * account sections so mobile hits exactly the same APIs as AccountSettingsPage.
 */
export function MobileAccountSectionPage() {
  const { t } = useTranslation(['account', 'mobile'])
  const { workspaceId = '', section } = useParams()

  if (!isSection(section)) {
    return <Navigate to={`/w/${workspaceId}/account`} replace />
  }

  const { titleKey, Component } = SECTIONS[section]

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <Link
        to={`/w/${workspaceId}/account`}
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500"
      >
        <IconChevronLeft size={17} />
        {t('mobile:account.title')}
      </Link>
      <h1 className="text-xl font-bold text-neutral-900 dark:text-white">{t(titleKey)}</h1>
      <div className="min-w-0 overflow-x-clip">
        <Component />
      </div>
    </div>
  )
}
