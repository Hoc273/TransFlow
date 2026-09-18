import { useEffect, useState } from 'react'
import { IconMenu2, IconSearch } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useUiStore } from '@/store/uiStore'
import { AvatarMenu } from './AvatarMenu'
import { GlobalSearchModal } from './GlobalSearchModal'
import { NotificationPopover } from './NotificationPopover'

interface TopNavProps {
  onMobileMenu?: () => void
}

export function TopNav({ onMobileMenu }: TopNavProps) {
  const { t } = useTranslation('common')
  const { workspaceId = 'demo' } = useParams()
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [searchOpen, setSearchOpen] = useState(false)

  // Listen to Cmd+K / Ctrl+K globally
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <header className="app-topnav">
      {/* Brand & sidebar toggle: fixed width (236px + 16px padding + 12px gap = 264px) to align search box vertically with main content */}
      <div className="flex items-center gap-2.5 sm:w-[236px] shrink-0">
        <button
          type="button"
          className="app-icon-btn shrink-0"
          onClick={() => {
            toggleSidebar()
            onMobileMenu?.()
          }}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <IconMenu2 size={18} />
        </button>

        <Link
          to={`/w/${workspaceId}`}
          className="flex items-center gap-2.5 no-underline text-[var(--color-accent)] shrink-0"
        >
          <img src="/favicon.svg" alt="TransFlow" className="h-7 w-7 object-contain drop-shadow-[0_0_8px_rgba(0,192,255,0.45)]" />
          <span className="text-[16px] font-bold tracking-tight text-[var(--color-text-primary)]">
            {t('appName')}
          </span>
        </Link>
      </div>

      {/* Global search trigger — vertically aligned with Media Localization Studio / Bảng điều khiển (264px) */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="group hidden sm:inline-flex items-center justify-between gap-3 h-9 w-44 md:w-56 lg:w-64 px-3 rounded-xl border border-neutral-200/90 dark:border-white/10 bg-neutral-100/70 dark:bg-white/[0.04] text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:border-neutral-300 dark:hover:border-white/20 hover:text-neutral-900 dark:hover:text-white transition-all cursor-pointer shadow-2xs"
        title={`${t('search')} (${typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K'})`}
        aria-label={`${t('search')} (${typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K'})`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <IconSearch size={15} className="text-neutral-400 group-hover:text-[var(--color-accent)] transition-colors shrink-0" />
          <span className="truncate">{t('search')}...</span>
        </div>
        <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-white dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700/80 shadow-2xs shrink-0">
          {typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <div className="flex-1" />

      {/* Mobile search icon button */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="sm:hidden app-icon-btn text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
        title={t('search')}
        aria-label={t('search')}
      >
        <IconSearch size={18} />
      </button>

      <LanguageSwitcher />

      <ThemeToggle className="h-[34px] w-[34px] rounded-md border-0 bg-transparent hover:bg-[var(--color-bg-hover)]" />

      <NotificationPopover />

      <AvatarMenu />

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        workspaceId={workspaceId}
      />
    </header>
  )
}
