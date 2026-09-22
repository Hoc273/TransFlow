import { useState, useRef, useEffect, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'

export function LandingPricing() {
  const { t } = useTranslation('landing')
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  const billingTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/dashboard/usage`
      : '/dashboard'
    : '/login'

  const sectionRef = useRef<HTMLElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  const starterFeatures = (t('pricing.starter.features', { returnObjects: true }) as string[]) || []
  const freelancerFeatures = (t('pricing.freelancer.features', { returnObjects: true }) as string[]) || []
  const proStudioFeatures = (t('pricing.proStudio.features', { returnObjects: true }) as string[]) || []

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
        }
      },
      { threshold: 0.1 }
    )
    if (sectionRef.current) {
      observer.observe(sectionRef.current)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={sectionRef} id="pricing" className="py-24 max-w-7xl mx-auto px-4 sm:px-6 relative overflow-hidden">
      {/* Background ambient decorative glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-blue-500/5 dark:bg-blue-500/10 blur-[120px] pointer-events-none rounded-full" />

      {/* Section Header */}
      <div
        className={`text-center max-w-3xl mx-auto mb-16 transition-all duration-700 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 dark:text-white">
          {t('pricing.title')}
        </h2>
      </div>

      {/* 3 Minimalist Animated Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch relative z-10">
        {/* Card 1: Starter */}
        <PricingCard
          isVisible={isVisible}
          delayClass="delay-0"
          spotlightColor="rgba(150, 150, 150, 0.1)"
          accentGradient="from-transparent via-neutral-400/80 dark:via-neutral-500/80 to-transparent"
          cardBorderClass="border-neutral-200 dark:border-white/10 hover:border-neutral-400 dark:hover:border-white/30 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.6)]"
        >
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
              {/* Minimalist Glyphic Tree Icon (1 Stalk) */}
              <div className="mb-6 inline-block transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-translate-y-1">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 36 36"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-neutral-900 dark:text-white transition-colors duration-300 group-hover:text-black dark:group-hover:text-white"
                >
                  <circle cx="18" cy="8" r="3" />
                  <line x1="18" y1="11" x2="18" y2="28" />
                  <circle cx="11" cy="18" r="2.5" />
                  <line x1="18" y1="21" x2="11" y2="18" />
                  <circle cx="25" cy="18" r="2.5" />
                  <line x1="18" y1="21" x2="25" y2="18" />
                </svg>
              </div>

              {/* Plan Name & Tagline */}
              <h3 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">
                {t('pricing.starter.name')}
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-6">
                {t('pricing.starter.desc')}
              </p>

              {/* Price Display */}
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-3xl sm:text-4xl font-bold text-neutral-900 dark:text-white">
                  {t('pricing.starter.price')}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t('pricing.starter.credits')}
                </span>
              </div>

              {/* Action CTA Button */}
              <Link
                to={billingTarget}
                className="group/btn relative overflow-hidden w-full py-3.5 px-4 rounded-xl bg-neutral-200 dark:bg-[#1a1d26] hover:bg-neutral-300 dark:hover:bg-[#222632] border border-transparent dark:border-white/10 text-neutral-900 dark:text-white font-medium text-sm text-center block transition-all duration-200 hover:scale-[1.01] active:scale-[0.98] mb-6 shadow-sm"
              >
                {/* Shimmer sweep */}
                <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span>{t('pricing.starter.cta')}</span>
                  <span className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1">→</span>
                </span>
              </Link>

              {/* Features List */}
              <div className="border-t border-neutral-200/80 dark:border-white/10 pt-6">
                <span className="block text-xs font-semibold text-neutral-900 dark:text-neutral-200 mb-4">
                  {t('pricing.starter.featuresTitle')}
                </span>
                <ul className="space-y-2.5 text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-300 leading-normal">
                  {starterFeatures.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 group/item transition-transform duration-150 hover:translate-x-1 cursor-default">
                      <span className="text-neutral-400 dark:text-neutral-500 group-hover/item:text-neutral-900 dark:group-hover/item:text-white transition-colors select-none">✓</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </PricingCard>

        {/* Card 2: Freelancer (Pro tier - Most popular) */}
        <PricingCard
          isVisible={isVisible}
          delayClass="delay-150"
          spotlightColor="rgba(59, 130, 246, 0.12)"
          accentGradient="from-transparent via-blue-500 to-transparent"
          cardBorderClass="border-blue-500/30 dark:border-blue-500/40 hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-[0_24px_50px_-12px_rgba(59,130,246,0.2)] dark:hover:shadow-[0_24px_50px_-12px_rgba(59,130,246,0.22)] shadow-sm ring-1 ring-blue-500/10"
        >
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
              {/* Top Row: Glyphic Tree Icon (3 Stalks) + Animated Bonus Pill */}
              <div className="flex items-center justify-between mb-6">
                <div className="inline-block transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-translate-y-1">
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 36 36"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-neutral-900 dark:text-white transition-all duration-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]"
                  >
                    <circle cx="18" cy="7" r="3" />
                    <line x1="18" y1="10" x2="18" y2="28" />
                    <circle cx="10" cy="16" r="2.5" />
                    <line x1="18" y1="21" x2="10" y2="16" />
                    <circle cx="26" cy="16" r="2.5" />
                    <line x1="18" y1="21" x2="26" y2="16" />
                    <circle cx="9" cy="24" r="2.5" />
                    <line x1="18" y1="26" x2="9" y2="24" />
                    <circle cx="27" cy="24" r="2.5" />
                    <line x1="18" y1="26" x2="27" y2="24" />
                  </svg>
                </div>

                {/* Pill with pulsing beacon */}
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 shadow-sm group-hover:scale-105 transition-transform duration-200">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  {t('pricing.freelancer.bonusBadge')}
                </span>
              </div>

              {/* Plan Name & Tagline */}
              <h3 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2">
                <span>{t('pricing.freelancer.name')}</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  {t('pricing.freelancer.badge')}
                </span>
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-6">
                {t('pricing.freelancer.desc')}
              </p>

              {/* Price Display */}
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-3xl sm:text-4xl font-bold text-neutral-900 dark:text-white">
                  {t('pricing.freelancer.price')}
                </span>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 leading-tight">
                  <div>{t('pricing.freelancer.credits')}</div>
                  <div className="text-blue-600 dark:text-blue-400 font-medium">{t('pricing.freelancer.bonus')}</div>
                </div>
              </div>

              {/* Action CTA Button */}
              <Link
                to={billingTarget}
                className="group/btn relative overflow-hidden w-full py-3.5 px-4 rounded-xl bg-neutral-900 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-neutral-950 font-semibold text-sm text-center block transition-all duration-200 hover:scale-[1.01] active:scale-[0.98] mb-6 shadow-md"
              >
                {/* Shimmer sweep */}
                <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 dark:via-black/10 to-transparent pointer-events-none" />
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span>{t('pricing.freelancer.cta')}</span>
                  <span className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1.5">→</span>
                </span>
              </Link>

              {/* Features List */}
              <div className="border-t border-neutral-200/80 dark:border-white/10 pt-6">
                <span className="block text-xs font-semibold text-neutral-900 dark:text-neutral-200 mb-4">
                  {t('pricing.freelancer.featuresTitle')}
                </span>
                <ul className="space-y-2.5 text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-300 leading-normal">
                  {freelancerFeatures.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 group/item transition-transform duration-150 hover:translate-x-1 cursor-default">
                      <span className="text-neutral-400 dark:text-neutral-500 group-hover/item:text-blue-500 dark:group-hover/item:text-blue-400 transition-colors select-none">✓</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </PricingCard>

        {/* Card 3: Pro Studio (Max tier) */}
        <PricingCard
          isVisible={isVisible}
          delayClass="delay-300"
          spotlightColor="rgba(16, 185, 129, 0.12)"
          accentGradient="from-transparent via-emerald-500 to-transparent"
          cardBorderClass="border-neutral-200 dark:border-white/10 hover:border-emerald-500/70 dark:hover:border-emerald-500/70 hover:shadow-[0_24px_50px_-12px_rgba(16,185,129,0.18)] dark:hover:shadow-[0_24px_50px_-12px_rgba(16,185,129,0.22)]"
        >
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
              {/* Top Row: Glyphic Tree Icon (5 Stalks) + Animated Bonus Pill */}
              <div className="flex items-center justify-between mb-6">
                <div className="inline-block transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-translate-y-1">
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 36 36"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-neutral-900 dark:text-white transition-all duration-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                  >
                    <circle cx="18" cy="6" r="3.5" />
                    <line x1="18" y1="9.5" x2="18" y2="29" />
                    <circle cx="8" cy="14" r="2.5" />
                    <line x1="18" y1="19" x2="8" y2="14" />
                    <circle cx="28" cy="14" r="2.5" />
                    <line x1="18" y1="19" x2="28" y2="14" />
                    <circle cx="6" cy="22" r="2.5" />
                    <line x1="18" y1="24" x2="6" y2="22" />
                    <circle cx="30" cy="22" r="2.5" />
                    <line x1="18" y1="24" x2="30" y2="22" />
                    <circle cx="11" cy="28" r="2" />
                    <line x1="18" y1="28" x2="11" y2="28" />
                    <circle cx="25" cy="28" r="2" />
                    <line x1="18" y1="28" x2="25" y2="28" />
                  </svg>
                </div>

                {/* Pill with pulsing beacon */}
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 shadow-sm group-hover:scale-105 transition-transform duration-200">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  {t('pricing.proStudio.bonusBadge')}
                </span>
              </div>

              {/* Plan Name & Tagline */}
              <h3 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">
                {t('pricing.proStudio.name')}
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-6">
                {t('pricing.proStudio.desc')}
              </p>

              {/* Price Display */}
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-3xl sm:text-4xl font-bold text-neutral-900 dark:text-white">
                  {t('pricing.proStudio.price')}
                </span>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 leading-tight">
                  <div>{t('pricing.proStudio.credits')}</div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-medium">{t('pricing.proStudio.bonus')}</div>
                </div>
              </div>

              {/* Action CTA Button */}
              <Link
                to={billingTarget}
                className="group/btn relative overflow-hidden w-full py-3.5 px-4 rounded-xl bg-neutral-900 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-neutral-950 font-semibold text-sm text-center block transition-all duration-200 hover:scale-[1.01] active:scale-[0.98] mb-6 shadow-md"
              >
                {/* Shimmer sweep */}
                <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/25 dark:via-black/10 to-transparent pointer-events-none" />
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span>{t('pricing.proStudio.cta')}</span>
                  <span className="inline-block transition-transform duration-200 group-hover/btn:translate-x-1.5">→</span>
                </span>
              </Link>

              {/* Features List */}
              <div className="border-t border-neutral-200/80 dark:border-white/10 pt-6">
                <span className="block text-xs font-semibold text-neutral-900 dark:text-neutral-200 mb-4">
                  {t('pricing.proStudio.featuresTitle')}
                </span>
                <ul className="space-y-2.5 text-xs sm:text-[13px] text-neutral-600 dark:text-neutral-300 leading-normal">
                  {proStudioFeatures.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 group/item transition-transform duration-150 hover:translate-x-1 cursor-default">
                      <span className="text-neutral-400 dark:text-neutral-500 group-hover/item:text-emerald-500 dark:group-hover/item:text-emerald-400 transition-colors select-none">✓</span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </PricingCard>
      </div>
    </section>
  )
}

function PricingCard({
  children,
  isVisible,
  delayClass,
  spotlightColor,
  accentGradient,
  cardBorderClass,
}: {
  children: React.ReactNode
  isVisible: boolean
  delayClass: string
  spotlightColor: string
  accentGradient: string
  cardBorderClass: string
}) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative rounded-3xl border bg-[#fafafa] dark:bg-[#13151b] p-8 flex flex-col justify-between transition-all duration-500 ease-out hover:-translate-y-2 overflow-hidden dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] ${cardBorderClass} ${delayClass} ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
      }`}
    >
      {/* Dynamic Cursor Spotlight (Linear/Vercel style) */}
      <div
        className="pointer-events-none absolute -inset-px rounded-3xl transition-opacity duration-300 opacity-0 group-hover:opacity-100"
        style={{
          background: isHovered
            ? `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, ${spotlightColor}, transparent 80%)`
            : undefined,
        }}
      />

      {/* Top Accent Gradient Line (Illuminates on hover) */}
      <div
        className={`absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r ${accentGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
      />

      {children}
    </div>
  )
}
