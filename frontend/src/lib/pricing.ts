import { intlLocale } from '@/lib/format'

/** Landing top-up packs. Credits are fixed; the price is picked per UI language (display only). */
export type PricingPlanKey = 'starter' | 'freelancer' | 'proStudio'

export const PLAN_CREDITS: Record<PricingPlanKey, number> = {
  starter: 2500,
  freelancer: 5250,
  proStudio: 10000,
}

const PLAN_ORDER: PricingPlanKey[] = ['starter', 'freelancer', 'proStudio']

const PRICE_TABLE: Record<string, { currency: string; amounts: [number, number, number] }> = {
  vi: { currency: 'VND', amounts: [250_000, 500_000, 900_000] },
  en: { currency: 'USD', amounts: [10, 20, 35] },
  ko: { currency: 'KRW', amounts: [13_000, 27_000, 47_000] },
}

/** Non-breaking space between the number and a trailing currency sign ("250.000 ₫" must not wrap). */
const nbsp = (s: string) => s.replace(/\s/g, ' ')

export function planPrice(plan: PricingPlanKey, language: string) {
  const code = (language ?? '').toLowerCase().split(/[-_]/)[0]
  const { currency, amounts } = PRICE_TABLE[code] ?? PRICE_TABLE.en
  const amount = amounts[PLAN_ORDER.indexOf(plan)]
  const locale = intlLocale(code in PRICE_TABLE ? code : 'en')
  const price = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
  const rate = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumSignificantDigits: 2,
  }).format(amount / PLAN_CREDITS[plan])
  return { price: nbsp(price), rate: nbsp(rate) }
}
