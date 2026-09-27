import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useUiStore, type Language } from '@/store/uiStore'

const LANGUAGES: Array<{ value: Language; code: string; name: string }> = [
  { value: 'vi', code: 'VI', name: 'Tiếng Việt' },
  { value: 'en', code: 'EN', name: 'English' },
  { value: 'ko', code: 'KO', name: '한국어' },
]

/**
 * Inline segmented language picker for mobile. Unlike the desktop dropdown it
 * never overflows, so it is safe inside clipped cards and bottom sheets.
 */
export function MobileLanguagePicker({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)

  const change = (lang: Language) => {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    localStorage.setItem('tf-lang', lang)
  }

  return (
    <div
      role="radiogroup"
      className={clsx(
        'inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800',
        className,
      )}
    >
      {LANGUAGES.map((lang) => {
        const active = lang.value === language
        return (
          <button
            key={lang.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={lang.name}
            title={lang.name}
            onClick={() => change(lang.value)}
            className={clsx(
              'h-7 min-w-[36px] rounded-md px-2 text-[11px] font-bold transition-colors',
              active
                ? 'bg-white text-primary shadow-xs dark:bg-neutral-950'
                : 'text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-700',
            )}
          >
            {lang.code}
          </button>
        )
      })}
    </div>
  )
}
