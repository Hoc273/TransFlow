import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconSubtitles,
  IconAlignLeft,
  IconArrowRight,
  IconArrowUpRight
} from '@tabler/icons-react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'

const DARK_HERO_VIDEO = '/landing/videos/dark1.mp4'
const LIGHT_HERO_VIDEO = '/landing/videos/hero_slide_1.mp4'

export function LandingHero() {
  const { t } = useTranslation('landing')
  const darkVideoRef = useRef<HTMLVideoElement | null>(null)
  const lightVideoRef = useRef<HTMLVideoElement | null>(null)
  const theme = useUiStore((s) => s.theme)
  const isDark = theme === 'dark'

  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  const authTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/media`
      : '/dashboard'
    : '/login'

  // Ensure active video auto-plays seamlessly
  useEffect(() => {
    if (isDark && darkVideoRef.current) {
      darkVideoRef.current.play()?.catch?.(() => {})
    } else if (!isDark && lightVideoRef.current) {
      lightVideoRef.current.play()?.catch?.(() => {})
    }
  }, [isDark])

  return (
    <section className="relative w-full overflow-hidden bg-white dark:bg-[#09090a] pt-28 pb-16 min-h-[560px] sm:min-h-[640px] lg:min-h-[720px] flex flex-col justify-between transition-colors duration-700 ease-in-out">
      {/* Edge-to-Edge Full Width Ambient Video Background (No poster flash, smooth cross-fade) */}
      <div className="absolute inset-0 w-full h-full overflow-hidden bg-white dark:bg-[#09090a] transition-colors duration-700 ease-in-out">
        <video
          ref={darkVideoRef}
          src={DARK_HERO_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${
            isDark ? 'opacity-100 z-0' : 'opacity-0 pointer-events-none'
          }`}
        />
        <video
          ref={lightVideoRef}
          src={LIGHT_HERO_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${
            !isDark ? 'opacity-100 z-0' : 'opacity-0 pointer-events-none'
          }`}
        />
      </div>

      {/* Very Light & Subtle Overlay to let the video shine brightly */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/30 pointer-events-none z-10" />

      {/* Smooth Bottom Transition to Page Background (Dual-layer cross-fade for seamless theme transitions) */}
      <div
        className={`absolute inset-x-0 bottom-0 h-36 sm:h-52 bg-gradient-to-t from-[#09090a] via-[#09090a]/80 to-transparent pointer-events-none z-10 transition-opacity duration-700 ease-in-out ${
          isDark ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 h-36 sm:h-52 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none z-10 transition-opacity duration-700 ease-in-out ${
          !isDark ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Structured Content Container (aligned with site grid) */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 w-full flex-1 flex flex-col justify-between">
        {/* Top Badges Row — responsive on mobile */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4 w-full">
          <div className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-white shadow-md">
            <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
            <span className="tracking-wide uppercase text-[10px] sm:text-[11px] font-semibold">
              {t('hero.flagship')}
            </span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-white shadow-md">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-[11px] sm:text-xs font-medium">{t('hero.engine')}</span>
          </div>
        </div>

        {/* Center Stage: Title, Description & Ultra-Premium Action Buttons */}
        <div className="flex flex-col items-center justify-center text-center my-auto py-8 sm:py-16">
          <div className="max-w-3xl mb-6 sm:mb-10">
            <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.15] sm:leading-[1.08] drop-shadow-lg">
              {t('hero.title')}
            </h1>
            <p className="text-white/90 text-xs sm:text-base md:text-lg mt-3 sm:mt-3.5 max-w-2xl mx-auto drop-shadow-md font-normal leading-relaxed px-2 sm:px-0">
              {t('hero.subtitle')}
            </p>
          </div>

          {/* 2 Ultra-Premium Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 sm:gap-6 w-full sm:w-auto px-4 sm:px-0">
            {/* Button 1: Dịch video (Obsidian Glass Finish) */}
            <Link
              to={authTarget}
              className="w-full sm:w-auto relative group inline-flex items-center justify-center gap-3 px-6 sm:px-10 py-3.5 sm:py-4 rounded-full bg-neutral-950/90 hover:bg-black text-white font-medium text-sm sm:text-base backdrop-blur-2xl border border-white/25 hover:border-white/45 shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:scale-[1.04] active:scale-[0.98] transition-all duration-300 cursor-pointer"
            >
              {/* Top specular highlight */}
              <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent pointer-events-none" />

              <span className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white border border-white/15 shadow-inner">
                <IconSubtitles size={16} stroke={1.8} />
              </span>

              <span className="tracking-tight font-semibold">{t('hero.translateBtn')}</span>

              <IconArrowRight
                size={16}
                stroke={2}
                className="text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all"
              />
            </Link>

            {/* Button 2: Tóm tắt (Liquid Crystal Glass Finish) */}
            <Link
              to={authTarget}
              className="w-full sm:w-auto relative group inline-flex items-center justify-center gap-3 px-6 sm:px-10 py-3.5 sm:py-4 rounded-full bg-white/90 hover:bg-white text-neutral-900 font-medium text-sm sm:text-base backdrop-blur-2xl border border-white/70 hover:border-white shadow-[0_20px_50px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,1)] hover:scale-[1.04] active:scale-[0.98] transition-all duration-300 cursor-pointer"
            >
              {/* Top specular highlight */}
              <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent pointer-events-none" />

              <span className="w-7 h-7 rounded-full bg-neutral-900/5 flex items-center justify-center text-neutral-800 border border-black/5 shadow-xs">
                <IconAlignLeft size={16} stroke={1.8} />
              </span>

              <span className="tracking-tight font-semibold">{t('hero.summarizeBtn')}</span>

              <IconArrowUpRight
                size={16}
                stroke={2}
                className="text-neutral-500 group-hover:text-neutral-900 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
              />
            </Link>
          </div>
        </div>

        {/* Empty bottom spacer to keep vertical balance */}
        <div className="h-6" />
      </div>
    </section>
  )
}
