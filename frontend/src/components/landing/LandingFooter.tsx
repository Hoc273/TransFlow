import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconBrandGithub, IconBrandDiscord, IconBrandX, IconShieldCheck } from '@tabler/icons-react'
import { Logo } from '@/components/shared/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { Modal } from '@/components/shared/Modal'
import { useAuthStore } from '@/store/authStore'

export function LandingFooter() {
  const { t } = useTranslation('landing')
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)

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

  const projectsTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/projects`
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
                <Link to={projectsTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.projects')}
                </Link>
              </li>
              <li>
                <Link to={glossaryTarget} className="hover:text-neutral-900 dark:hover:text-white transition-colors">
                  {t('footer.glossary')}
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
                <button
                  type="button"
                  onClick={() => setPrivacyOpen(true)}
                  className="text-left hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  {t('footer.privacy')}
                </button>
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
            <button
              type="button"
              onClick={() => setPrivacyOpen(true)}
              className="hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            >
              {t('footer.privacy')}
            </button>
            <button
              type="button"
              onClick={() => setTermsOpen(true)}
              className="hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors cursor-pointer"
            >
              {t('footer.terms')}
            </button>
            <div className="flex items-center gap-2">
              <LanguageSwitcher menuPlacement="top" className="h-8 px-2.5 rounded-lg border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08] text-xs font-semibold" />
              <ThemeToggle className="h-8 w-8 rounded-lg border border-neutral-200/90 dark:border-white/10 bg-neutral-100/90 dark:bg-white/[0.08]" />
            </div>
          </div>
        </div>
      </div>

      {/* Privacy Policy Modal */}
      <Modal
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        title={t('footer.privacyModal.title')}
        description={t('footer.privacyModal.desc')}
        size="lg"
      >
        <div className="space-y-4 text-xs sm:text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
          <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex items-start gap-3">
            <IconShieldCheck size={22} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <h5 className="font-semibold text-neutral-900 dark:text-white">
                {t('footer.privacyModal.badge')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {t('footer.privacyModal.badgeDesc')}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {t('footer.privacyModal.p1Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.privacyModal.p1Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {t('footer.privacyModal.p2Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.privacyModal.p2Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {t('footer.privacyModal.p3Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.privacyModal.p3Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {t('footer.privacyModal.p4Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.privacyModal.p4Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                {t('footer.privacyModal.p5Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.privacyModal.p5Desc')}
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <a
              href="#privacy"
              onClick={() => setPrivacyOpen(false)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#714ffc] dark:text-[#a78bff] hover:underline"
            >
              <span>{t('footer.privacy')} ({t('nav.pipeline')}) →</span>
            </a>
          </div>
        </div>
      </Modal>

      {/* Terms of Service Modal */}
      <Modal
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        title={t('footer.termsModal.title')}
        description={t('footer.termsModal.desc')}
        size="lg"
      >
        <div className="space-y-4 text-xs sm:text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-3">
            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                {t('footer.termsModal.t1Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.termsModal.t1Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                {t('footer.termsModal.t2Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.termsModal.t2Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                {t('footer.termsModal.t3Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.termsModal.t3Desc')}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3.5 space-y-1">
              <h5 className="font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                {t('footer.termsModal.t4Title')}
              </h5>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 pl-3.5">
                {t('footer.termsModal.t4Desc')}
              </p>
            </div>
          </div>
        </div>
      </Modal>
    </footer>
  )
}
