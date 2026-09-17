import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconMenu2,
  IconX,
  IconArrowRight,
} from '@tabler/icons-react'
import { Logo } from '@/components/shared/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useAuthStore } from '@/store/authStore'

export function LandingNavbar() {
  const { t } = useTranslation('landing')
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  const studioTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/media`
      : '/dashboard'
    : '/login'

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 15)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        scrolled
          ? 'bg-white/85 dark:bg-[#09090a]/85 backdrop-blur-md border-b border-black/5 dark:border-white/10 shadow-xs'
          : 'bg-white/50 dark:bg-[#09090a]/50 backdrop-blur-xs border-b border-black/5 dark:border-white/10'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo matching original site */}
        <div className="flex items-center gap-6 shrink-0">
          <Logo to="/" />
        </div>

        {/* Center Nav Items */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <a
            href="#pipeline"
            className="text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors"
          >
            {t('nav.pipeline')}
          </a>
          <a
            href="#productivity"
            className="text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors"
          >
            {t('nav.productivity')}
          </a>
          <a
            href="#customers"
            className="text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors"
          >
            {t('nav.customers')}
          </a>
          <a
            href="#pricing"
            className="text-neutral-600 dark:text-neutral-300 hover:text-black dark:hover:text-white transition-colors"
          >
            {t('nav.pricing')}
          </a>
        </nav>

        {/* Right Actions: Switchers & Auth */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center gap-1.5">
            <LanguageSwitcher className="h-9 px-2.5 rounded-xl border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-white/[0.12] transition-colors text-xs font-semibold shadow-xs" />
            <ThemeToggle className="h-9 w-9 rounded-xl border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/80 dark:hover:bg-white/[0.12] transition-colors shadow-xs" />
          </div>

          {accessToken ? (
            <Link
              to={studioTarget}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs sm:text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shadow-xs hover:scale-[1.02]"
            >
              <span>{t('nav.studio')}</span>
              <IconArrowRight size={14} stroke={2} />
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden sm:inline-block text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-black dark:hover:text-white px-2 py-1.5 transition-colors"
              >
                {t('nav.login')}
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs sm:text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shadow-xs hover:scale-[1.02]"
              >
                <span>{t('nav.startFree')}</span>
                <IconArrowRight size={14} stroke={2} />
              </Link>
            </>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-1.5 text-neutral-700 dark:text-neutral-200 cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-white/95 dark:bg-[#09090a]/95 backdrop-blur-lg border-b border-neutral-200 dark:border-neutral-800 px-6 py-5 flex flex-col gap-3.5 shadow-xl">
          <a
            href="#pipeline"
            onClick={() => setMobileOpen(false)}
            className="text-sm font-medium text-neutral-800 dark:text-neutral-200 py-1"
          >
            {t('nav.pipeline')}
          </a>
          <a
            href="#productivity"
            onClick={() => setMobileOpen(false)}
            className="text-sm font-medium text-neutral-800 dark:text-neutral-200 py-1"
          >
            {t('nav.productivity')}
          </a>
          <a
            href="#customers"
            onClick={() => setMobileOpen(false)}
            className="text-sm font-medium text-neutral-800 dark:text-neutral-200 py-1"
          >
            {t('nav.customers')}
          </a>
          <a
            href="#pricing"
            onClick={() => setMobileOpen(false)}
            className="text-sm font-medium text-neutral-800 dark:text-neutral-200 py-1"
          >
            {t('nav.pricing')}
          </a>

          <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LanguageSwitcher menuAlign="left" className="h-8 px-2 rounded-lg border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08] text-xs font-semibold" />
              <ThemeToggle className="h-8 w-8 rounded-lg border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08]" />
            </div>

            {!accessToken && (
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="text-xs font-semibold text-neutral-700 dark:text-neutral-300"
              >
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
