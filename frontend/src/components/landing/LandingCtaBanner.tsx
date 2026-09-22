import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'

/**
 * Boosts sampled video pixel colors to luminous, high-contrast HSL values
 * so text remains crisp, vibrant, and readable against any background.
 */
function boostVideoColor(r: number, g: number, b: number, fallback: string): string {
  if (r + g + b < 35) return fallback

  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / d + 2
        break
      case bNorm:
        h = (rNorm - gNorm) / d + 4
        break
    }
    h /= 6
  }

  const hueDeg = Math.round(h * 360)
  // Ensure high vibrancy saturation (80-100%)
  const sat = Math.max(Math.round(s * 100), 80)
  // Ensure readability lightness (64-78%)
  const light = Math.min(Math.max(Math.round(l * 100), 64), 78)

  return `hsl(${hueDeg}, ${sat}%, ${light}%)`
}

export function LandingCtaBanner() {
  const { t } = useTranslation('landing')
  const theme = useUiStore((s) => s.theme)
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [dynamicColors, setDynamicColors] = useState({
    c1: '#38bdf8',
    c2: '#818cf8',
    c3: '#c084fc',
  })

  // Real-time video color sampling: syncs text gradient with the active video waves
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let canvas: HTMLCanvasElement | null = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 9
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const updateColors = () => {
      if (!video || video.paused || video.ended || !ctx || video.readyState < 2) return
      try {
        ctx.drawImage(video, 0, 0, 16, 9)
        // Sample left, center, and right across the middle video row
        const p1 = ctx.getImageData(3, 4, 1, 1).data
        const p2 = ctx.getImageData(8, 4, 1, 1).data
        const p3 = ctx.getImageData(13, 4, 1, 1).data

        setDynamicColors({
          c1: boostVideoColor(p1[0], p1[1], p1[2], '#38bdf8'),
          c2: boostVideoColor(p2[0], p2[1], p2[2], '#818cf8'),
          c3: boostVideoColor(p3[0], p3[1], p3[2], '#c084fc'),
        })
      } catch {
        // Silently fall back if canvas read is unavailable
      }
    }

    const intervalId = setInterval(updateColors, 180)
    return () => {
      clearInterval(intervalId)
      canvas = null
    }
  }, [theme])

  const authTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/media`
      : '/dashboard'
    : '/register'

  return (
    <section className="py-10 max-w-7xl mx-auto px-4 sm:px-6">
      <style>{`
        @keyframes dynamicTextFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      <div className="relative rounded-2xl sm:rounded-[32px] overflow-hidden border border-neutral-200/80 dark:border-white/10 aspect-auto sm:aspect-[24/8] min-h-[280px] sm:min-h-[360px] flex flex-col items-center justify-center text-center p-5 sm:p-12 shadow-sm dark:shadow-2xl bg-neutral-100 dark:bg-[#13151b] group">
        {/* Ambient Video Background (Darkskip in dark mode, footer_brand in light mode) */}
        <video
          ref={videoRef}
          key={theme}
          src={
            theme === 'dark'
              ? '/landing/videos/Darkskip.mp4'
              : '/landing/videos/footer_brand.mp4'
          }
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover pointer-events-none group-hover:scale-105 transition-transform duration-1000 ease-out"
        />

        {/* Minimal Soft Scrim to keep video bright and vibrant while text stays readable */}
        <div className="absolute inset-0 bg-black/15 dark:bg-black/25 pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center max-w-3xl w-full">
          {/* Benefits Notification Pill */}
          <Link
            to={authTarget}
            className="group/pill inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 rounded-full border border-white/20 bg-white/15 dark:bg-black/40 backdrop-blur-md text-xs font-medium text-white hover:bg-white/25 transition-all shadow-sm mb-4 sm:mb-6"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="truncate max-w-[200px] sm:max-w-none">{t('ctaBanner.pill')}</span>
            <span className="text-blue-300 group-hover/pill:text-blue-200 font-semibold flex items-center transition-transform duration-200 group-hover/pill:translate-x-0.5 shrink-0">
              {t('ctaBanner.pillCta')}
            </span>
          </Link>

          {/* Action-Oriented Headline with Real-Time Video-Synced Shimmer */}
          <h2 className="text-2xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white tracking-tight leading-tight mb-3 sm:mb-4 drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
            <span
              style={{
                backgroundImage: `linear-gradient(120deg, ${dynamicColors.c1} 0%, ${dynamicColors.c2} 45%, ${dynamicColors.c3} 80%, ${dynamicColors.c1} 100%)`,
                backgroundSize: '240% auto',
                animation: 'dynamicTextFlow 6s ease infinite',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: `drop-shadow(0 0 28px ${dynamicColors.c2})`,
                transition: 'filter 0.5s ease',
              }}
              className="inline-block"
            >
              {t('ctaBanner.headline')}
            </span>
          </h2>

          <p className="text-white/95 text-xs sm:text-sm md:text-base max-w-xl mx-auto mb-6 sm:mb-8 font-medium leading-relaxed drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)] line-clamp-3 sm:line-clamp-none">
            {t('ctaBanner.desc')}
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 sm:gap-4 w-full sm:w-auto px-2 sm:px-0">
            <Link
              to={authTarget}
              className="inline-flex items-center justify-center px-6 sm:px-8 py-3 sm:py-3.5 rounded-full bg-white hover:bg-neutral-100 text-neutral-950 font-semibold text-xs sm:text-sm transition-all shadow-lg hover:scale-105 active:scale-95 duration-200 w-full sm:w-auto text-center cursor-pointer"
            >
              {t('ctaBanner.btnFree')}
            </Link>

            <a
              href="#pricing"
              className="inline-flex items-center justify-center px-6 sm:px-8 py-3 sm:py-3.5 rounded-full bg-black/40 hover:bg-black/60 border border-white/30 text-white font-medium text-xs sm:text-sm transition-all shadow-sm backdrop-blur-md hover:border-white/50 hover:scale-105 active:scale-95 duration-200 w-full sm:w-auto text-center cursor-pointer"
            >
              {t('ctaBanner.btnPricing')}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
