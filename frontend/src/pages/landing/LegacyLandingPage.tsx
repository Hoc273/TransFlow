import { useEffect, useRef } from 'react'
import './landing.css'
import { Link, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconArrowRight,
  IconPlayerPlay,
  IconCheck,
  IconDatabase,
  IconBook2,
  IconShieldCheck,
  IconLayoutGrid,
  IconLock,
  IconUsers,
  IconFileText,
  IconLanguage,
  IconBuilding,
  IconVideo,
  IconUser,
  IconChevronRight,
} from '@tabler/icons-react'
import { Logo } from '@/components/shared/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'

const HERO_IMG = '/land_pic_1.jpeg'
const MEDIA_IMG = '/land_pic_2.png'
const CREATIVE_IMG = '/land_pic_3.png'

const LANG_PILLS = [
  '🇻🇳 Tiếng Việt',
  '🇺🇸 English',
  '🇯🇵 日本語',
  '🇰🇷 한국어',
  '🇨🇳 中文',
  '🇫🇷 Français',
  '🇩🇪 Deutsch',
  '🇪🇸 Español',
  '🇵🇹 Português',
  '🇷🇺 Русский',
  '🇸🇦 العربية',
  '🇹🇭 ภาษาไทย',
  '🇮🇩 Bahasa',
  '🇮🇳 हिन्दी',
]

function useStatCounters() {
  const refs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const els = refs.current.filter(Boolean) as HTMLDivElement[]
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => {
        el.textContent = `${el.dataset.target || 0}${el.dataset.suffix || ''}`
      })
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const el = entry.target as HTMLDivElement
          const target = Number(el.dataset.target || 0)
          const suffix = el.dataset.suffix || ''
          let current = 0
          const step = Math.max(1, Math.ceil(target / 60))
          const timer = window.setInterval(() => {
            current += step
            if (current >= target) {
              current = target
              window.clearInterval(timer)
            }
            el.textContent = `${current}${suffix}`
          }, 25)
          observer.unobserve(el)
        })
      },
      { threshold: 0.3 },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return refs
}

export function LegacyLandingPage() {
  const { t } = useTranslation('landing')
  useDocumentTitle('TransFlow — AI Translation Platform')
  const statRefs = useStatCounters()
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  // Already signed in → jump into last/current workspace (same as GuestGuard).
  if (accessToken) {
    const wsId = currentWorkspace?.id ?? getLastWorkspaceId()
    if (wsId) return <Navigate to={`/w/${wsId}`} replace />
    return <Navigate to="/no-workspace" replace />
  }

  const features = [
    {
      icon: IconDatabase,
      title: t('features.tm.title'),
      desc: t('features.tm.desc'),
      extra: (
        <div className="mt-4 flex items-center gap-2">
          <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-400">
            exact match
          </span>
          <span className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-400">
            fuzzy 85%
          </span>
        </div>
      ),
    },
    {
      icon: IconBook2,
      title: t('features.glossary.title'),
      desc: t('features.glossary.desc'),
      extra: (
        <div className="mt-4 font-mono text-[11px] text-[var(--color-lp-text-3)]">
          brand_name → &quot;Acme Corp&quot; ✓
        </div>
      ),
    },
    {
      icon: IconShieldCheck,
      title: t('features.qa.title'),
      desc: t('features.qa.desc'),
      extra: (
        <div className="mt-4 flex items-center gap-1.5">
          <span className="rounded border border-red-500/20 bg-red-500/15 px-2 py-1 text-[10px] font-semibold text-red-400">
            CRITICAL
          </span>
          <span className="rounded border border-amber-500/20 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-400">
            HIGH
          </span>
          <span className="rounded border border-yellow-500/20 bg-yellow-500/15 px-2 py-1 text-[10px] text-yellow-400">
            MED
          </span>
        </div>
      ),
    },
    {
      icon: IconLayoutGrid,
      title: t('features.batch.title'),
      desc: t('features.batch.desc'),
      extra: (
        <div className="mt-4 flex items-center gap-2 text-[11px]">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-lp-bg-3)]">
            <div className="h-full w-[73%] bg-[#714ffc]" />
          </div>
          <span className="font-mono text-[var(--color-lp-text-2)]">11/15</span>
        </div>
      ),
    },
    {
      icon: IconLock,
      title: t('features.byok.title'),
      desc: t('features.byok.desc'),
      extra: (
        <div className="mt-4 flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-lp-text-3)]">
          <IconLock size={12} className="text-emerald-400" />
          sk-...••••abcd
        </div>
      ),
    },
    {
      icon: IconUsers,
      title: t('features.workspace.title'),
      desc: t('features.workspace.desc'),
      extra: (
        <div className="mt-4 flex gap-1">
          {['A', 'P', 'T', 'R'].map((ch, i) => (
            <span
              key={ch}
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white',
                i === 0 && 'bg-pink-500',
                i === 1 && 'bg-blue-500',
                i === 2 && 'bg-emerald-500',
                i === 3 && 'bg-amber-500',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {ch}
            </span>
          ))}
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-lp-border-2)] bg-[var(--color-lp-bg-3)] text-[10px] text-[var(--color-lp-text-3)]">
            +3
          </span>
        </div>
      ),
    },
  ]

  const pipelineSteps = [
    { key: 'intake', icon: IconFileText, color: 'slate', status: '✓ 2.1s', statusClass: 'text-emerald-400' },
    { key: 'tm', icon: IconDatabase, color: 'emerald', status: '✓ 42% hit', statusClass: 'text-emerald-400' },
    { key: 'glossary', icon: IconBook2, color: 'purple', status: '✓ 7 matches', statusClass: 'text-emerald-400' },
    { key: 'ai', icon: IconLanguage, color: 'blue', status: '◐ running', statusClass: 'text-blue-400', pulse: true },
    { key: 'qa', icon: IconShieldCheck, color: 'amber', status: '— pending', statusClass: 'text-[var(--color-lp-text-3)]' },
    { key: 'writeback', icon: IconArrowRight, color: 'rose', status: '— pending', statusClass: 'text-[var(--color-lp-text-3)]' },
  ] as const

  const mediaItems = t('studios.media.items', { returnObjects: true }) as string[]
  const creativeItems = t('studios.creative.items', { returnObjects: true }) as string[]
  const starterItems = t('pricing.starter.items', { returnObjects: true }) as string[]
  const teamItems = t('pricing.team.items', { returnObjects: true }) as string[]
  const enterpriseItems = t('pricing.enterprise.items', { returnObjects: true }) as string[]

  return (
    <div className="lp-root min-h-screen">
      {/* NAV */}
      <nav className="lp-nav-blur fixed inset-x-0 top-0 z-50">
        <div className="mx-auto grid h-16 max-w-[1700px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center justify-start">
            <Logo badge="MVP" />
          </div>
          <div className="hidden items-center justify-center gap-6 whitespace-nowrap text-[13.5px] xl:flex 2xl:gap-7">
            <a href="#features" className="lp-nav-link">
              {t('nav.features')}
            </a>
            <a href="#pipeline" className="lp-nav-link">
              {t('nav.pipeline')}
            </a>
            <a href="#studios" className="lp-nav-link">
              {t('nav.studios')}
            </a>
            <a href="#use-cases" className="lp-nav-link">
              {t('nav.useCases')}
            </a>
            <a href="#pricing" className="lp-nav-link">
              {t('nav.pricing')}
            </a>
            <span className="cursor-default text-[var(--color-lp-text-3)] opacity-60">{t('nav.docs')}</span>
          </div>
          <div className="col-start-3 flex min-w-0 items-center justify-end gap-2">
            <div className="hidden sm:block">
              <LanguageSwitcher className="lp-icon-btn" />
            </div>
            <ThemeToggle className="lp-icon-btn" />
            <Link
              to="/login"
              className="hidden whitespace-nowrap px-3 py-1.5 text-[13px] text-[var(--color-lp-text-2)] hover:text-[var(--color-lp-text-1)] md:block"
            >
              {t('nav.login')}
            </Link>
            <Link
              to="/register"
              className="lp-btn-primary flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] sm:px-4"
            >
              {t('nav.cta')}
              <IconArrowRight size={12} stroke={2.5} />
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative overflow-hidden pb-14 pt-24 lg:flex lg:min-h-[calc(100dvh-5rem)] lg:items-center lg:pb-16 lg:pt-20">
        <div className="relative z-10 mx-auto w-full max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,0.55fr)] lg:gap-10 xl:gap-14">
            <div className="relative z-20 flex min-w-0 flex-col items-start">
              <div className="lp-hero-chip mb-6 inline-flex max-w-full flex-wrap items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px]">
                <span className="lp-pulse-dot" />
                <span className="text-[var(--color-lp-text-2)]">{t('hero.badgeNew')}</span>
                <span className="font-medium text-[var(--color-lp-text-1)]">{t('hero.badgeText')}</span>
                <span className="lp-mono rounded border border-[var(--color-lp-accent)]/35 bg-[var(--color-lp-accent)]/18 px-1.5 py-0.5 text-[10px] text-[var(--color-lp-accent-3)]">
                  v1.0
                </span>
                <IconChevronRight size={12} className="text-[var(--color-lp-text-3)]" />
              </div>

              <h1 className="mb-6 max-w-[12ch] text-4xl font-bold leading-[1.04] sm:text-5xl xl:text-6xl 2xl:text-[68px]">
                <span className="lp-grad-text">{t('hero.titleLine1')}</span>
                <br />
                <span className="text-[var(--color-lp-text-1)]">{t('hero.titleLine2')}</span>
              </h1>
              <p className="mb-8 max-w-[620px] text-[16px] leading-relaxed text-[var(--color-lp-text-2)] sm:text-[17px]">
                {t('hero.subtitle')}
              </p>

              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/register"
                  className="lp-btn-primary flex items-center gap-2 whitespace-nowrap rounded-xl px-7 py-3.5 text-[14px]"
                >
                  {t('hero.ctaPrimary')}
                  <IconArrowRight size={14} stroke={2.5} />
                </Link>
                <button
                  type="button"
                  className="lp-btn-ghost flex items-center gap-2 whitespace-nowrap rounded-xl px-7 py-3.5 text-[14px]"
                >
                  <IconPlayerPlay size={14} />
                  {t('hero.ctaDemo')}
                </button>
              </div>

              <div className="mt-4 flex items-center gap-1.5 text-[12px] text-[var(--color-lp-text-3)]">
                <span className="lp-kbd">⌘</span>
                <span className="lp-kbd">K</span>
                <span className="ml-1">{t('hero.cmdHint')}</span>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px] text-[var(--color-lp-text-3)]">
                {[t('hero.trustNoCard'), t('hero.trustByok'), t('hero.trustSoc')].map((label) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <IconCheck size={14} className="text-emerald-400" stroke={2} />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="lp-hero-visual relative mx-auto w-full max-w-[860px] py-7 sm:px-8 sm:py-10 lg:px-5 xl:px-8">
              <div className="lp-hero-mockup relative z-10">
                <img
                  src={HERO_IMG}
                  width={1199}
                  height={959}
                  fetchPriority="high"
                  className="aspect-[5/4] w-full object-cover"
                  alt="TransFlow multilingual media translation workspace"
                />
              </div>
              <div className="lp-hero-float lp-hero-float-top" aria-hidden="true">
                <img
                  src={CREATIVE_IMG}
                  width={1024}
                  height={1024}
                  className="h-full w-full object-cover"
                  alt=""
                />
              </div>
              <div className="lp-hero-float lp-hero-float-bottom" aria-hidden="true">
                <img
                  src={MEDIA_IMG}
                  width={1024}
                  height={1024}
                  className="h-full w-full object-cover"
                  alt=""
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="lp-section-muted relative border-y border-[var(--color-lp-border)] py-16">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {[
              { target: 119, suffix: '', label: t('stats.languages') },
              { target: 98, suffix: '%', label: t('stats.qaAccuracy') },
              { target: 10, suffix: '×', label: t('stats.faster') },
              { target: 24, suffix: '/7', label: t('stats.pipeline') },
            ].map((stat, i) => (
              <div key={stat.label} className="text-center">
                <div
                  ref={(el) => {
                    statRefs.current[i] = el
                  }}
                  className="lp-stat-num lp-mono"
                  data-target={stat.target}
                  data-suffix={stat.suffix}
                >
                  0
                </div>
                <div className="mt-2 text-[13px] text-[var(--color-lp-text-2)]">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative py-24">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <div className="lp-badge-chip lp-mono mb-4 px-3 py-1 text-[11px] font-medium">
              {t('features.badge')}
            </div>
            <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              {t('features.title')} <span className="lp-grad-text-2">{t('features.titleAccent')}</span>
            </h2>
            <p className="text-[15px] text-[var(--color-lp-text-2)]">{t('features.subtitle')}</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="lp-glow-card p-6">
                <div className="lp-feature-icon mb-4">
                  <f.icon size={20} stroke={1.75} />
                </div>
                <h3 className="mb-2 text-[16px] font-semibold">{f.title}</h3>
                <p className="text-[13px] leading-relaxed text-[var(--color-lp-text-2)]">{f.desc}</p>
                {f.extra}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PIPELINE */}
      <section id="pipeline" className="relative overflow-hidden py-24">
        <div className="relative mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <div className="lp-badge-chip lp-mono mb-4 px-3 py-1 text-[11px] font-medium">
              {t('pipeline.badge')}
            </div>
            <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              {t('pipeline.title')} <span className="lp-grad-text-2">{t('pipeline.titleAccent')}</span>
            </h2>
            <p className="text-[15px] text-[var(--color-lp-text-2)]">{t('pipeline.subtitle')}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {pipelineSteps.map((step) => (
              <div key={step.key} className="lp-pipeline-node text-center">
                <div
                  className={`relative mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border ${
                    step.color === 'slate'
                      ? 'border-slate-500/30 bg-slate-500/15 text-slate-300'
                      : step.color === 'emerald'
                        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                        : step.color === 'purple'
                          ? 'border-[#714ffc]/30 bg-[#714ffc]/15 text-[#a78bff]'
                          : step.color === 'blue'
                            ? 'border-blue-500/30 bg-blue-500/15 text-blue-400'
                            : step.color === 'amber'
                              ? 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                              : 'border-rose-500/30 bg-rose-500/15 text-rose-400'
                  }`}
                >
                  <step.icon size={18} stroke={1.75} />
                  {'pulse' in step && step.pulse && (
                    <span className="lp-pulse-dot absolute -right-1 -top-1 h-3 w-3 border-2 border-[var(--color-lp-bg-2)]" />
                  )}
                </div>
                <div className="text-[13px] font-semibold">{t(`pipeline.steps.${step.key}.title`)}</div>
                <div className="mt-1 text-[11px] text-[var(--color-lp-text-3)]">
                  {t(`pipeline.steps.${step.key}.desc`)}
                </div>
                <div className={`lp-mono mt-2 text-[10px] ${step.statusClass}`}>{step.status}</div>
              </div>
            ))}
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <div className="lp-code-block p-5">
              <div className="mb-3 flex items-center gap-2 border-b border-[var(--color-lp-border)] pb-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <span className="ml-2 text-[11px] text-[var(--color-lp-text-3)]">
                  TranslationOrchestrator.java
                </span>
              </div>
              <pre className="text-[11.5px] leading-relaxed text-[var(--color-lp-text-2)]">
                <code>
                  <span className="text-[#c792ea]">public</span>{' '}
                  <span className="text-[#82aaff]">void</span>{' '}
                  <span className="text-[#82aaff]">translateJob</span>(
                  <span className="text-[#ffcb6b]">Job</span> job) {'{\n'}
                  {'  '}
                  <span className="text-[var(--color-lp-text-3)]">{'// 1. Segment → TM lookup'}</span>
                  {'\n  '}
                  <span className="text-[var(--color-lp-text-3)]">{'// 2. Glossary filter'}</span>
                  {'\n  '}
                  <span className="text-[var(--color-lp-text-3)]">{'// 3. AI translate (SSE)'}</span>
                  {'\n  '}
                  <span className="text-[var(--color-lp-text-3)]">{'// 4. QA dual-agent'}</span>
                  {'\n  '}
                  <span className="text-[var(--color-lp-text-3)]">{'// 5. Auto-fix ≤ 1 vòng'}</span>
                  {'\n  '}
                  <span className="text-[var(--color-lp-text-3)]">{'// 6. TM write-back + History'}</span>
                  {'\n}'}
                </code>
              </pre>
            </div>
            <div className="lp-code-block p-5">
              <div className="mb-3 flex items-center gap-2 border-b border-[var(--color-lp-border)] pb-3">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <span className="ml-2 text-[11px] text-[var(--color-lp-text-3)]">
                  POST /ai/translate — SSE stream
                </span>
              </div>
              <pre className="text-[11.5px] leading-relaxed text-[var(--color-lp-text-2)]">
                <code>
                  <span className="text-[var(--color-lp-text-3)]">event:</span>{' '}
                  <span className="text-[#82aaff]">token</span>
                  {'\n'}
                  <span className="text-[var(--color-lp-text-3)]">data:</span>{' '}
                  {'{"text":"'}
                  <span className="text-emerald-400">Xin chào</span>
                  {'","conf":0.97}'}
                  {'\n\n'}
                  <span className="text-[var(--color-lp-text-3)]">event:</span>{' '}
                  <span className="text-[#82aaff]">token</span>
                  {'\n'}
                  <span className="text-[var(--color-lp-text-3)]">data:</span>{' '}
                  {'{"text":"'}
                  <span className="text-emerald-400"> thế giới</span>
                  {'","conf":0.95}'}
                  {'\n\n'}
                  <span className="text-[var(--color-lp-text-3)]">event:</span>{' '}
                  <span className="text-[#ffcb6b]">done</span>
                  {'\n'}
                  <span className="text-[var(--color-lp-text-3)]">data:</span>{' '}
                  {'{"tokens":14,"model":"gpt-4"}'}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* STUDIOS */}
      <section id="studios" className="relative py-24">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <div className="lp-badge-chip lp-mono mb-4 px-3 py-1 text-[11px] font-medium">
              {t('studios.badge')}
            </div>
            <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              {t('studios.title')} <span className="lp-grad-text-2">{t('studios.titleAccent')}</span>
            </h2>
            <p className="text-[15px] text-[var(--color-lp-text-2)]">{t('studios.subtitle')}</p>
          </div>

          <div className="lp-studio-card mb-8">
            <div className="grid gap-0 lg:grid-cols-2">
              <div className="relative p-10 lg:p-14">
                <div className="lp-mono mb-5 inline-flex items-center gap-2 rounded-md border border-[var(--color-lp-accent)]/25 bg-[var(--color-lp-accent)]/15 px-2.5 py-1 text-[11px] text-[var(--color-lp-accent-3)]">
                  {t('studios.media.badge')}
                </div>
                <h3 className="mb-4 text-3xl font-bold">
                  {t('studios.media.title')}
                  <br />
                  {t('studios.media.titleSub')}
                </h3>
                <p className="mb-6 text-[14px] leading-relaxed text-[var(--color-lp-text-2)]">
                  {t('studios.media.desc')}
                </p>
                <ul className="mb-8 space-y-3">
                  {mediaItems.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[13px]">
                      <div className="lp-check-icon mt-0.5">✓</div>
                      <span className="text-[var(--color-lp-text-2)]">{item}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="lp-btn-ghost flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13px]">
                  {t('studios.media.cta')}
                  <IconArrowRight size={12} stroke={2.5} />
                </button>
              </div>
              <div className="relative min-h-[400px] overflow-hidden bg-[var(--color-lp-bg-2)]">
                <img
                  src={MEDIA_IMG}
                  width={1024}
                  height={1024}
                  loading="lazy"
                  className="h-full w-full object-cover opacity-90"
                  alt="TransFlow Media Studio video localization preview"
                />
              </div>
            </div>
          </div>

          <div className="lp-studio-card">
            <div className="grid gap-0 lg:grid-cols-2">
              <div className="relative order-2 min-h-[400px] overflow-hidden bg-[var(--color-lp-bg-2)] lg:order-1">
                <img
                  src={CREATIVE_IMG}
                  width={1024}
                  height={1024}
                  loading="lazy"
                  className="h-full w-full object-cover opacity-80"
                  alt="TransFlow translation memory and creative workflow preview"
                />
              </div>
              <div className="relative order-1 p-10 lg:order-2 lg:p-14">
                <div className="lp-mono mb-5 inline-flex items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-300">
                  {t('studios.creative.badge')}
                </div>
                <h3 className="mb-4 text-3xl font-bold">
                  {t('studios.creative.title')}
                  <br />
                  {t('studios.creative.titleSub')}
                </h3>
                <p className="mb-6 text-[14px] leading-relaxed text-[var(--color-lp-text-2)]">
                  {t('studios.creative.desc')}
                </p>
                <ul className="mb-8 space-y-3">
                  {creativeItems.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-[13px]">
                      <div className="lp-check-icon mt-0.5">✓</div>
                      <span className="text-[var(--color-lp-text-2)]">{item}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="lp-btn-ghost flex items-center gap-2 rounded-lg px-5 py-2.5 text-[13px]">
                  {t('studios.creative.cta')}
                  <IconArrowRight size={12} stroke={2.5} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section id="use-cases" className="lp-section-muted relative border-y border-[var(--color-lp-border)] py-24">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <div className="lp-badge-chip lp-mono mb-4 px-3 py-1 text-[11px] font-medium">
              {t('useCases.badge')}
            </div>
            <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              {t('useCases.title')} <span className="lp-grad-text-2">{t('useCases.titleAccent')}</span>
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                icon: IconBuilding,
                color: 'blue',
                title: t('useCases.enterprise.title'),
                desc: t('useCases.enterprise.desc'),
                meta: t('useCases.enterprise.meta'),
              },
              {
                icon: IconVideo,
                color: 'fuchsia',
                title: t('useCases.agency.title'),
                desc: t('useCases.agency.desc'),
                meta: t('useCases.agency.meta'),
              },
              {
                icon: IconUser,
                color: 'emerald',
                title: t('useCases.freelancer.title'),
                desc: t('useCases.freelancer.desc'),
                meta: t('useCases.freelancer.meta'),
              },
            ].map((card) => (
              <div key={card.title} className="lp-use-case-card">
                <div
                  className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl border ${
                    card.color === 'blue'
                      ? 'border-blue-500/30 bg-blue-500/15 text-blue-400'
                      : card.color === 'fuchsia'
                        ? 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300'
                        : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                  }`}
                >
                  <card.icon size={22} stroke={1.75} />
                </div>
                <h3 className="mb-2 text-[18px] font-semibold">{card.title}</h3>
                <p className="mb-4 text-[13px] leading-relaxed text-[var(--color-lp-text-2)]">{card.desc}</p>
                <div className="lp-mono text-[12px] text-[var(--color-lp-text-3)]">{card.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LANGUAGES */}
      <section className="relative overflow-hidden py-20">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mb-10 text-center">
            <h3 className="mb-3 text-2xl font-bold md:text-3xl">
              {t('languages.title')} <span className="lp-grad-text-2">{t('languages.titleAccent')}</span>
            </h3>
            <p className="text-[14px] text-[var(--color-lp-text-2)]">{t('languages.subtitle')}</p>
          </div>
          <div className="relative overflow-hidden">
            <div className="lp-marquee">
              {[...LANG_PILLS, ...LANG_PILLS].map((lang, i) => (
                <div key={`${lang}-${i}`} className="lp-lang-pill">
                  {lang}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="relative py-24">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <div className="lp-badge-chip lp-mono mb-4 px-3 py-1 text-[11px] font-medium">
              {t('pricing.badge')}
            </div>
            <h2 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              {t('pricing.title')} <span className="lp-grad-text-2">{t('pricing.titleAccent')}</span>
            </h2>
            <p className="text-[15px] text-[var(--color-lp-text-2)]">{t('pricing.subtitle')}</p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
            {/* Starter */}
            <div className="lp-pricing-card">
              <div className="mb-2 text-[13px] text-[var(--color-lp-text-3)]">{t('pricing.starter.name')}</div>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{t('pricing.starter.price')}</span>
              </div>
              <div className="mb-6 text-[13px] text-[var(--color-lp-text-2)]">{t('pricing.starter.desc')}</div>
              <Link
                to="/register"
                className="lp-btn-ghost mb-6 block w-full rounded-lg py-2.5 text-center text-[13px]"
              >
                {t('pricing.starter.cta')}
              </Link>
              <ul className="space-y-3 text-[13px]">
                {starterItems.map((item, i) => (
                  <li
                    key={item}
                    className={`flex items-start gap-2.5 ${i === starterItems.length - 1 ? 'text-[var(--color-lp-text-3)]' : ''}`}
                  >
                    <div className="lp-check-icon mt-0.5" style={i === starterItems.length - 1 ? { opacity: 0.4 } : undefined}>
                      ✓
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Team */}
            <div className="lp-pricing-card featured relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#714ffc] px-3 py-1 text-[10px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(113,79,252,0.65)]">
                {t('pricing.team.popular')}
              </div>
              <div className="mb-2 text-[13px] text-[var(--color-lp-accent-3)]">{t('pricing.team.name')}</div>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{t('pricing.team.price')}</span>
                <span className="text-[var(--color-lp-text-3)]">{t('pricing.team.unit')}</span>
              </div>
              <div className="mb-6 text-[13px] text-[var(--color-lp-text-2)]">{t('pricing.team.desc')}</div>
              <Link
                to="/register"
                className="lp-btn-primary mb-6 block w-full rounded-lg py-2.5 text-center text-[13px]"
              >
                {t('pricing.team.cta')}
              </Link>
              <ul className="space-y-3 text-[13px]">
                {teamItems.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <div className="lp-check-icon mt-0.5">✓</div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Enterprise */}
            <div className="lp-pricing-card">
              <div className="mb-2 text-[13px] text-[var(--color-lp-text-3)]">{t('pricing.enterprise.name')}</div>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{t('pricing.enterprise.price')}</span>
              </div>
              <div className="mb-6 text-[13px] text-[var(--color-lp-text-2)]">{t('pricing.enterprise.desc')}</div>
              <button type="button" className="lp-btn-ghost mb-6 w-full rounded-lg py-2.5 text-[13px]">
                {t('pricing.enterprise.cta')}
              </button>
              <ul className="space-y-3 text-[13px]">
                {enterpriseItems.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <div className="lp-check-icon mt-0.5">✓</div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden py-24">
        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
          <h2 className="mb-6 text-5xl font-bold tracking-tight md:text-6xl">
            {t('finalCta.title')} <span className="lp-grad-text">{t('finalCta.titleAccent')}</span>?
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-[16px] text-[var(--color-lp-text-2)]">
            {t('finalCta.subtitle')}
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="lp-btn-primary flex items-center gap-2 rounded-xl px-8 py-4 text-[15px]"
            >
              {t('finalCta.primary')}
              <IconArrowRight size={14} stroke={2.5} />
            </Link>
            <button type="button" className="lp-btn-ghost rounded-xl px-8 py-4 text-[15px]">
              {t('finalCta.secondary')}
            </button>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-[12px] text-[var(--color-lp-text-3)]">
            {['SOC 2 Type II', 'GDPR compliant', 'ISO 27001', '99.9% uptime SLA'].map((label) => (
              <div key={label} className="flex items-center gap-1.5">
                <IconCheck size={14} className="text-emerald-400" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer relative border-t border-[var(--color-lp-border)] py-16">
        <div className="mx-auto max-w-[1600px] px-6 md:px-8 lg:px-10 xl:px-12">
          <div className="mb-12 grid gap-8 md:grid-cols-5">
            <div className="md:col-span-2">
              <div className="mb-4">
                <Logo />
              </div>
              <p className="mb-5 max-w-xs text-[13px] leading-relaxed text-[var(--color-lp-text-2)]">
                {t('footer.tagline')}
              </p>
              <div className="flex items-center gap-2">
                <span className="lp-pulse-dot" />
                <span className="text-[12px] text-[var(--color-lp-text-3)]">{t('footer.status')}</span>
              </div>
            </div>
            <div>
              <div className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-lp-text-3)]">
                {t('footer.product')}
              </div>
              <ul className="space-y-2.5 text-[13px] text-[var(--color-lp-text-2)]">
                <li>{t('footer.textStudio')}</li>
                <li>{t('footer.mediaStudio')}</li>
                <li>{t('footer.creativeStudio')}</li>
                <li>{t('footer.changelog')}</li>
              </ul>
            </div>
            <div>
              <div className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-lp-text-3)]">
                {t('footer.resources')}
              </div>
              <ul className="space-y-2.5 text-[13px] text-[var(--color-lp-text-2)]">
                <li>{t('nav.docs')}</li>
                <li>{t('footer.api')}</li>
                <li>{t('footer.blog')}</li>
                <li>{t('footer.community')}</li>
              </ul>
            </div>
            <div>
              <div className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-lp-text-3)]">
                {t('footer.company')}
              </div>
              <ul className="space-y-2.5 text-[13px] text-[var(--color-lp-text-2)]">
                <li>{t('footer.about')}</li>
                <li>{t('footer.careers')}</li>
                <li>{t('footer.contact')}</li>
                <li>{t('footer.security')}</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-4 border-t border-[var(--color-lp-border)] pt-8 text-[12px] text-[var(--color-lp-text-3)] md:flex-row">
            <div>{t('footer.rights')}</div>
            <div className="flex items-center gap-6">
              <span>{t('common:privacy', { defaultValue: 'Privacy' })}</span>
              <span>{t('common:terms', { defaultValue: 'Terms' })}</span>
              <span>{t('footer.cookies')}</span>
              <LanguageSwitcher className="lp-icon-btn" menuPlacement="top" />
              <ThemeToggle className="lp-icon-btn" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
