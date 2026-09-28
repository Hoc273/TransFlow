import { Link } from 'react-router-dom'
import { IconBell, IconCoins, IconSearch } from '@tabler/icons-react'
import { MobileWorkspaceSwitcher } from '../components/MobileWorkspaceSwitcher'
import { AvatarMenu } from '@/components/layout/AvatarMenu'
import { useUserCredit } from '@/hooks/useCredit'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { useTranslation } from 'react-i18next'

interface MobileHeaderProps {
  workspaceId?: string
  onOpenSearch?: () => void
}

export function MobileHeader({ workspaceId, onOpenSearch }: MobileHeaderProps) {
  const { t } = useTranslation('mobile')
  const language = useUiStore((s) => s.language)
  const { data: credit, isLoading: creditLoading } = useUserCredit()
  const balance = Number(credit?.balance ?? 0)

  return (
    <header className="sticky top-0 z-[45] w-full border-b border-neutral-200 bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 pt-[env(safe-area-inset-top,0px)] overflow-visible">
      <div className="flex h-14 min-w-0 items-center justify-between gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <Link
            to={`/w/${workspaceId}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center"
            aria-label={t('mobile:header.home')}
          >
            <img
              src="/favicon.svg"
              alt="TransFlow"
              className="h-7 w-7 object-contain drop-shadow-[0_0_8px_rgba(0,192,255,0.45)]"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <MobileWorkspaceSwitcher />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Link
            to={`/w/${workspaceId}/account/credit`}
            data-testid="mobile-header-credit"
            aria-label={t('mobile:header.credit', { value: formatNumber(balance, language) })}
            title={t('mobile:header.credit', { value: formatNumber(balance, language) })}
            className="flex h-8 max-w-[84px] items-center gap-1 rounded-full bg-primary/10 px-2 text-[11px] font-bold tabular-nums text-primary active:bg-primary/20"
          >
            <IconCoins size={14} className="shrink-0" />
            <span className="truncate">{creditLoading ? '…' : formatCompactNumber(balance, language)}</span>
          </Link>
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex h-10 w-9 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
              aria-label={t('mobile:header.search')}
            >
              <IconSearch size={19} />
            </button>
          )}
          <Link
            to={`/w/${workspaceId}/notifications`}
            className="flex h-10 w-9 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
            aria-label={t('mobile:header.notifications')}
          >
            <IconBell size={19} />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center">
            <AvatarMenu guideInNewTab={false} />
          </div>
        </div>
      </div>
    </header>
  )
}
