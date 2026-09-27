import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  const [searchQuery, setSearchQuery] = useState('')
  const headerInputRef = useRef<HTMLInputElement>(null)
  const paletteKeyHandler = useRef<((e: ReactKeyboardEvent<HTMLInputElement>) => void) | null>(null)

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

  // Focus the header search box whenever the palette opens (e.g. via Ctrl+K)
  useEffect(() => {
    if (searchOpen) {
      const id = window.setTimeout(() => headerInputRef.current?.focus(), 50)
      return () => window.clearTimeout(id)
    }
    paletteKeyHandler.current = null
  }, [searchOpen])

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    paletteKeyHandler.current = null
  }

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

      {/* Global search box — centered in header; typing opens the dropdown below */}
      <div className="relative flex min-w-0 flex-1 justify-center">
        <div className="group hidden w-full max-w-md sm:flex items-center gap-2 h-9 px-3 rounded-xl border border-neutral-200/90 dark:border-white/10 bg-neutral-100/70 dark:bg-white/[0.04] text-xs text-neutral-500 dark:text-neutral-400 transition-all shadow-2xs focus-within:border-[var(--color-accent)] focus-within:bg-white dark:focus-within:bg-white/[0.08]">
          <IconSearch size={15} className="text-neutral-400 group-hover:text-[var(--color-accent)] transition-colors shrink-0" />
          <input
            ref={headerInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
                headerInputRef.current?.blur()
                return
              }
              if (searchOpen) paletteKeyHandler.current?.(e)
            }}
            placeholder={`${t('search')}...`}
            aria-label={`${t('search')} (${typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K'})`}
            className="flex-1 min-w-0 bg-transparent text-xs font-medium text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none"
          />
          <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-white dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700/80 shadow-2xs shrink-0">
            {typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'}
          </kbd>
        </div>

        <GlobalSearchModal
          open={searchOpen}
          onClose={closeSearch}
          workspaceId={workspaceId}
          layout="anchor"
          query={searchQuery}
          onQueryChange={setSearchQuery}
          hideSearchInput
          registerKeyHandler={(h) => {
            paletteKeyHandler.current = h
          }}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <LanguageSwitcher />

        <ThemeToggle className="h-[34px] w-[34px] rounded-md border-0 bg-transparent hover:bg-[var(--color-bg-hover)]" />

        <NotificationPopover />

        <AvatarMenu />
      </div>
    </header>
  )
}
