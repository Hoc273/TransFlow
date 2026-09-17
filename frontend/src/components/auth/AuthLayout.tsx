import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconDatabase,
  IconBook2,
  IconShieldCheck,
  IconStack2,
} from '@tabler/icons-react'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { Link } from 'react-router-dom'
import '@/pages/auth/auth.css'

interface AuthLayoutProps {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation('auth')

  const chips = [
    { icon: IconDatabase, label: t('feat.tm') },
    { icon: IconBook2, label: t('feat.glossary') },
    { icon: IconShieldCheck, label: t('feat.qa') },
    { icon: IconStack2, label: t('feat.batch') },
  ]

  return (
    <div className="auth-shell">
      <aside className="auth-brand-panel">
        <video
          src="/auth_circle_loop.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="auth-circle-video"
          aria-hidden="true"
        />

        {/* Top Logo */}
        <div className="auth-brand-header">
          <Link
            to="/"
            className="flex items-center gap-3 text-[19px] font-bold tracking-tight text-white no-underline transition-opacity hover:opacity-90"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-white/20 bg-white/10 backdrop-blur-md shadow-sm overflow-hidden p-1">
              <img src="/favicon.svg" alt="TransFlow" className="h-full w-full object-contain drop-shadow-[0_0_8px_rgba(0,192,255,0.6)]" />
            </div>
            <span>TransFlow</span>
          </Link>
        </div>

        {/* Center Hero: Airy & Decorative */}
        <div className="auth-brand-hero">
          <h1 className="auth-hero-title">
            {t('headline')}
          </h1>
          <p className="auth-hero-subtitle">
            {t('subtitle')}
          </p>

          <div className="auth-chips-row">
            {chips.map((chip) => {
              const Icon = chip.icon
              return (
                <div key={chip.label} className="auth-subtle-chip">
                  <Icon size={14} className="opacity-80" />
                  <span>{chip.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bottom Testimonial: Minimalist Frosted Card */}
        <div className="auth-quote-card">
          <p className="auth-quote-text">{t('testimonial.quote')}</p>
          <div className="auth-quote-author">
            <div className="auth-quote-avatar">TH</div>
            <div className="min-w-0">
              <strong className="block text-xs font-semibold text-white">
                {t('testimonial.author')}
              </strong>
              <span className="block text-[11px] text-white/70">
                {t('testimonial.role')}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative flex flex-col items-center justify-center px-8 py-12">
        <div className="absolute right-7 top-6 flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[400px]">
          <Link
            to="/"
            className="auth-mobile-logo mb-8 hidden items-center gap-3 text-[18px] font-bold text-[var(--color-text-primary)] no-underline"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] overflow-hidden p-0.5">
              <img src="/favicon.svg" alt="TransFlow" className="h-full w-full object-contain drop-shadow-[0_0_6px_rgba(0,192,255,0.5)]" />
            </div>
            TransFlow
          </Link>
          {children}
        </div>
      </main>
    </div>
  )
}
