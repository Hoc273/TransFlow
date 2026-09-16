import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import './landing.css'
import {
  LandingNavbar,
  LandingHero,
  LandingPipeline,
  LandingProductivity,
  LandingCustomerStories,
  LandingPricing,
  LandingCtaBanner,
  LandingFooter,
} from '@/components/landing'

export function LandingPage() {
  const { t, i18n } = useTranslation('landing')

  useEffect(() => {
    document.title = t('pageTitle')
  }, [t, i18n.language])

  return (
    <div className="min-h-screen bg-white dark:bg-[#09090a] text-neutral-900 dark:text-neutral-100 font-sans selection:bg-[#714ffc]/20 selection:text-[#714ffc] transition-colors duration-700 ease-in-out">
      <LandingNavbar />
      <main>
        <LandingHero />
        <LandingPipeline />
        <LandingProductivity />
        <LandingCustomerStories />
        <LandingPricing />
        <LandingCtaBanner />
      </main>
      <LandingFooter />
    </div>
  )
}
