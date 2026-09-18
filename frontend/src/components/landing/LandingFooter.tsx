import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconBrandGithub, IconBrandDiscord, IconBrandX } from '@tabler/icons-react'
import { Logo } from '@/components/shared/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useAuthStore } from '@/store/authStore'

export function LandingFooter() {
  const { t } = useTranslation('landing')
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  const mediaTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/media`
      : '/dashboard'
    : '/login'

  const batchTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/batches`
      : '/dashboard'
    : '/login'

  const tmTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/tm`
      : '/dashboard'
    : '/login'

  const glossaryTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/glossaries`
      : '/dashboard'
    : '/login'

  return (
    <footer className="border-t border-neutral-200 dark:border-white/10 bg-white dark:bg-[#09090a] pt-16 pb-12 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Main Grid: Brand info + 3 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-16">
          {/* Brand Info */}
          <div className="md:col-span-5 space-y-4">
            <div className="flex items-center gap-2">
              <Logo to="/" />
            </div>

            <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm leading-relaxed">
              {t('footer.tagline')}
            </p>

            {/* System Status with living beacon */}
            <div className="flex items-center gap-2 pt-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[12px] text-neutral-500 dark:text-neutral-400 font-medium">
                {t('footer.systemStatus')}
              </span>
            </div>

            <div className="flex items-center gap-4 text-neutral-400 pt-2">
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                title="GitHub"
              >
                <IconBrandGithub size={18} />
              </a>
              <a
                href="https://discord.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                title="Discord"
              >
                <IconBrandDiscord size={18} />
              </a>
              <a
                href="https://x.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
                title="X"
              >
                <IconBrandX size={18} />
              </a>
            </div>
          </div>

          {/* Column 1: Sản phẩm (Product) */}
          <div className="md:col-span-2 md:col-start-7">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white mb-4">
              {t('footer.colProduct')}
            </h4>
            <ul className="space-y-3 text-xs text-neutral-500 dark:text-neutral-400">
              <li>
                <Link to={mediaTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.mediaStudio')}
                </Link>
              </li>
              <li>
                <Link to={mediaTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.aiSummary')}
                </Link>
              </li>
              <li>
                <Link to={batchTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.batchMatrix')}
                </Link>
              </li>
              <li>
                <Link to={glossaryTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.glossary')}
                </Link>
              </li>
              <li>
                <Link to={tmTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.tm')}
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 2: Quy trình & Tính năng */}
          <div className="md:col-span-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white mb-4">
              {t('footer.colFeatures')}
            </h4>
            <ul className="space-y-3 text-xs text-neutral-500 dark:text-neutral-400">
              <li>
                <a href="#pipeline" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.pipelineSteps')}
                </a>
              </li>
              <li>
                <a href="#productivity" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.voiceSeparation')}
                </a>
              </li>
              <li>
                <a href="#productivity" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.qaAudit')}
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.pricingTable')}
                </a>
              </li>
            </ul>
          </div>

          {/* Column 3: Về TransFlow */}
          <div className="md:col-span-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white mb-4">
              {t('footer.colCompany')}
            </h4>
            <ul className="space-y-3 text-xs text-neutral-500 dark:text-neutral-400">
              <li>
                <a href="#customers" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.creatorStories')}
                </a>
              </li>
              <li>
                <Link to="/register" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.register')}
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.login')}
                </Link>
              </li>
              <li>
                <a href="#privacy" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.privacy')}
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Copyright & Controls */}
        <div className="pt-8 border-t border-neutral-100 dark:border-neutral-800/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-400">
          <div>
            {t('footer.copyright')}
          </div>

          <div className="flex flex-wrap items-center gap-6 text-neutral-500 dark:text-neutral-400">
            <a href="#privacy" className="hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors">
              {t('footer.privacy')}
            </a>
            <a href="#terms" className="hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors">
              {t('footer.terms')}
            </a>
            <div className="flex items-center gap-2">
              <LanguageSwitcher menuPlacement="top" className="h-8 px-2.5 rounded-lg border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08] text-xs font-semibold" />
              <ThemeToggle className="h-8 w-8 rounded-lg border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08]" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
