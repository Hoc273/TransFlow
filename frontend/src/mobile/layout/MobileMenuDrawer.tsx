import { Link } from 'react-router-dom'
import {
  IconBook,
  IconBook2,
  IconChartBar,
  IconChevronRight,
  IconCoins,
  IconMoon,
  IconSun,
  IconUser,
  IconUsers,
  IconAdjustments,
  IconLogout,
  IconWorld,
} from '@tabler/icons-react'
import { BottomSheet } from '../components/BottomSheet'
import { MobileLanguagePicker } from '../components/MobileLanguagePicker'
import { useUserCredit } from '@/hooks/useCredit'
import { formatNumber } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from 'react-i18next'

interface MobileMenuDrawerProps {
  isOpen: boolean
  onClose: () => void
  workspaceId?: string
}

export function MobileMenuDrawer({ isOpen, onClose, workspaceId }: MobileMenuDrawerProps) {
  const { t } = useTranslation(['mobile', 'common', 'account'])
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const language = useUiStore((s) => s.language)
  const logout = useAuthStore((s) => s.logout)
  const { data: credit, isLoading: creditLoading } = useUserCredit()

  const links = [
    { label: t('mobile:menu.glossaries'), to: `/w/${workspaceId}/glossaries`, icon: <IconBook size={18} /> },
    { label: t('mobile:menu.presets'), to: `/w/${workspaceId}/media/presets`, icon: <IconAdjustments size={18} /> },
    { label: t('mobile:menu.members'), to: `/w/${workspaceId}/settings/members`, icon: <IconUsers size={18} /> },
    { label: t('mobile:menu.usage'), to: `/w/${workspaceId}/dashboard/usage`, icon: <IconChartBar size={18} /> },
    { label: t('mobile:menu.account'), to: `/w/${workspaceId}/account`, icon: <IconUser size={18} /> },
    { label: t('mobile:menu.guide'), to: '/guide', icon: <IconBook2 size={18} /> },
  ]

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('mobile:menu.title')}>
      <div className="flex min-w-0 flex-col gap-1 pb-4">
        <Link
          to={`/w/${workspaceId}/account/credit`}
          onClick={onClose}
          data-testid="mobile-menu-credit"
          className="mb-2 flex min-w-0 items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 active:bg-primary/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <IconCoins size={18} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
              {t('common:creditBalance')}
            </span>
            <span className="truncate text-sm font-bold tabular-nums text-primary">
              {creditLoading ? '…' : formatNumber(Number(credit?.balance ?? 0), language)}{' '}
              <span className="text-[11px] font-normal text-neutral-500">{t('account:credit.unit')}</span>
            </span>
          </span>
          <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
        </Link>

        {links.map((lnk) => (
          <Link
            key={lnk.to}
            to={lnk.to}
            onClick={onClose}
            className="flex min-h-[48px] min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-neutral-800 transition-colors active:bg-neutral-100 dark:text-neutral-200 dark:active:bg-neutral-800"
          >
            <span className="shrink-0 text-neutral-500">{lnk.icon}</span>
            <span className="min-w-0 flex-1 truncate">{lnk.label}</span>
          </Link>
        ))}

        <div className="my-2 border-t border-neutral-100 dark:border-neutral-800" />

        <div className="flex min-h-[48px] min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <IconWorld size={18} className="shrink-0 text-neutral-500" />
            <span className="truncate">{t('mobile:menu.language')}</span>
          </div>
          <MobileLanguagePicker />
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className="flex min-h-[48px] min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-3 text-sm font-medium text-neutral-800 transition-colors active:bg-neutral-100 dark:text-neutral-200 dark:active:bg-neutral-800"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {theme === 'dark' ? <IconSun size={18} className="shrink-0 text-yellow-500" /> : <IconMoon size={18} className="shrink-0 text-neutral-500" />}
            <span className="truncate">{theme === 'dark' ? t('mobile:menu.switchToLight') : t('mobile:menu.switchToDark')}</span>
          </div>
          <span className="shrink-0 whitespace-nowrap text-xs capitalize text-neutral-400">{theme === 'dark' ? t('mobile:account.dark') : t('mobile:account.light')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose()
            logout()
          }}
          className="flex min-h-[48px] min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-red-600 transition-colors active:bg-red-50 dark:text-red-400 dark:active:bg-neutral-800"
        >
          <IconLogout size={18} className="shrink-0" />
          <span className="truncate">{t('mobile:account.logout')}</span>
        </button>
      </div>
    </BottomSheet>
  )
}
