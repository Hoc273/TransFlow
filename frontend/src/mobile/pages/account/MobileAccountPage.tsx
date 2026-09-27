import { Link, useParams } from 'react-router-dom'
import {
  IconBell,
  IconBuilding,
  IconChevronRight,
  IconCoins,
  IconKey,
  IconLock,
  IconLogout,
  IconMoon,
  IconSun,
  IconUser,
  IconWorld,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { MobileCard } from '../../components/MobileCard'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'

export function MobileAccountPage() {
  const { t } = useTranslation('account')
  const { workspaceId } = useParams()
  const user = useAuthStore((s) => s.user)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)
  const logout = useAuthStore((s) => s.logout)

  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  const wsId = workspaceId ?? currentWorkspace?.id
  const baseAccountPath = wsId ? `/w/${wsId}/account` : '/account'

  const userFallback = t('mobile:account.userFallback')
  const displayName = user?.fullName || (user as { name?: string })?.name || userFallback
  const displayEmail = user?.email || ''
  const avatarInitial = displayName !== userFallback
    ? displayName.trim()[0]?.toUpperCase() ?? 'U'
    : displayEmail
      ? displayEmail.trim()[0]?.toUpperCase() ?? 'U'
      : 'U'

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">{t('mobile:account.title')}</h1>

      {/* Profile summary card */}
      <MobileCard className="flex min-w-0 items-center gap-3 p-4">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-lg font-bold"
          aria-label={t('mobile:account.avatar')}
        >
          {avatarInitial}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-neutral-900 dark:text-white" title={displayName}>
            {displayName}
          </span>
          {displayEmail && (
            <span className="truncate text-xs text-neutral-500" title={displayEmail}>{displayEmail}</span>
          )}
        </div>
      </MobileCard>

      {/* Settings navigation group */}
      <div className="min-w-0 space-y-2">
        <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{t('mobile:account.settings')}</h2>
        <MobileCard className="min-w-0 divide-y divide-neutral-100 dark:divide-neutral-800 p-0 overflow-hidden">
          {/* Profile */}
          <Link
            to={`${baseAccountPath}/profile`}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconUser size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('mobile:account.profile')}
              </span>
            </div>
            <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
          </Link>

          {/* Credit */}
          <Link
            to={`${baseAccountPath}/credit`}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconCoins size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('nav.credit')}
              </span>
            </div>
            <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
          </Link>

          {/* Security & Password */}
          <Link
            to={`${baseAccountPath}/security`}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconLock size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('mobile:account.security')}
              </span>
            </div>
            <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
          </Link>

          {/* API keys (BYOK providers) */}
          <Link
            to={`${baseAccountPath}/api-keys`}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconKey size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('nav.apiKeys')}
              </span>
            </div>
            <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
          </Link>

          {/* My workspaces */}
          <Link
            to={`${baseAccountPath}/workspaces`}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconBuilding size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('nav.myWorkspaces')}
              </span>
            </div>
            <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
          </Link>

          {/* Notification Preferences */}
          <Link
            to={`${baseAccountPath}/preferences`}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconBell size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('mobile:account.notificationPrefs')}
              </span>
            </div>
            <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
          </Link>

          {/* Language */}
          <div className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconWorld size={18} className="text-neutral-500 shrink-0" />
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('mobile:account.language')}
              </span>
            </div>
            <LanguageSwitcher menuAlign="right" />
          </div>

          {/* Theme Toggle (Sáng / Tối) */}
          <div
            role="button"
            tabIndex={0}
            data-testid="theme-toggle-row"
            onClick={toggleTheme}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggleTheme()
              }
            }}
            className="flex min-h-[52px] min-w-0 items-center justify-between gap-2 p-3.5 active:bg-neutral-50 dark:active:bg-neutral-800/50 cursor-pointer transition-colors select-none"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {theme === 'dark' ? (
                <IconSun size={18} className="text-amber-500 shrink-0" />
              ) : (
                <IconMoon size={18} className="text-neutral-500 shrink-0" />
              )}
              <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('mobile:account.appearance', { mode: theme === 'dark' ? t('mobile:account.dark') : t('mobile:account.light') })}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-xs text-neutral-400 font-medium">
                {theme === 'dark' ? t('mobile:account.dark') : t('mobile:account.light')}
              </span>
              <div
                className={clsx(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                  theme === 'dark' ? 'bg-primary' : 'bg-neutral-300 dark:bg-neutral-700'
                )}
              >
                <span
                  className={clsx(
                    'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                    theme === 'dark' ? 'translate-x-4' : 'translate-x-1'
                  )}
                />
              </div>
            </div>
          </div>
        </MobileCard>
      </div>

      {/* Logout button */}
      <button
        type="button"
        onClick={() => logout()}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 p-3 text-sm font-semibold text-red-600 dark:text-red-400 active:bg-red-50 dark:active:bg-red-950/30 transition-colors cursor-pointer"
      >
        <IconLogout size={18} />
        <span>{t('mobile:account.logout')}</span>
      </button>
    </div>
  )
}
