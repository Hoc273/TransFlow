import { useEffect, useState, type ReactNode } from 'react'
import {
  IconCheck,
  IconLayoutList,
  IconList,
  IconMoon,
  IconSun,
  IconWorld,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { applyThemeToDocument, useUiStore, type Language, type ThemeMode } from '@/store/uiStore'
import { cn } from '@/lib/cn'

const DENSITY_KEY = 'tf-table-density'
type Density = 'comfortable' | 'dense'

function readDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY)
    return v === 'dense' ? 'dense' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

/**
 * Preferences Section — Visual customization & display settings.
 */
export function PreferencesSection() {
  const { t, i18n } = useTranslation(['account', 'common'])
  const language = useUiStore((s) => s.language)
  const theme = useUiStore((s) => s.theme)
  const setLanguage = useUiStore((s) => s.setLanguage)
  const setTheme = useUiStore((s) => s.setTheme)
  const [density, setDensity] = useState<Density>(readDensity)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    applyThemeToDocument(theme)
  }, [theme])

  const showSaved = () => {
    setFlash(true)
    window.setTimeout(() => setFlash(false), 2000)
  }

  const changeLang = (lang: Language) => {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    try {
      localStorage.setItem('tf-lang', lang)
    } catch {
      /* ignore */
    }
    showSaved()
  }

  const changeTheme = (mode: ThemeMode) => {
    setTheme(mode)
    applyThemeToDocument(mode)
    showSaved()
  }

  const changeDensity = (d: Density) => {
    setDensity(d)
    try {
      localStorage.setItem(DENSITY_KEY, d)
    } catch {
      /* ignore */
    }
    showSaved()
  }

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {flash && (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400 animate-in fade-in">
          <IconCheck size={16} className="shrink-0" />
          <span>{t('account:prefs.saveSuccess')}</span>
        </div>
      )}

      {/* Language Selection Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="border-b border-[var(--color-border)] pb-4 mb-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconWorld size={16} className="text-[var(--color-accent)]" />
            {t('account:prefs.langTitle')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:prefs.langDesc')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <OptionCard
            selected={language === 'en'}
            badge="EN"
            title="English"
            subtitle="Default language (US)"
            onClick={() => changeLang('en')}
          />
          <OptionCard
            selected={language === 'vi'}
            badge="VI"
            title="Tiếng Việt"
            subtitle="Giao diện tiếng Việt chuẩn hóa"
            onClick={() => changeLang('vi')}
          />
        </div>
      </div>

      {/* Theme Selection Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="border-b border-[var(--color-border)] pb-4 mb-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconMoon size={16} className="text-[var(--color-accent)]" />
            {t('account:prefs.themeTitle')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:prefs.themeDesc')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <OptionCard
            selected={theme === 'dark'}
            icon={<IconMoon size={18} className="text-[var(--color-accent)]" />}
            title={t('account:prefs.themeDark')}
            subtitle={t('account:prefs.themeDarkSub')}
            preview={
              <div className="mt-2 flex h-7 items-center gap-1.5 rounded-md bg-[#09090a] px-2.5 border border-[#26262b]">
                <div className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                <div className="h-1.5 w-10 rounded-full bg-[#30333a]" />
                <div className="h-1.5 w-6 rounded-full bg-[#1c1d22]" />
              </div>
            }
            onClick={() => changeTheme('dark')}
          />
          <OptionCard
            selected={theme === 'light'}
            icon={<IconSun size={18} className="text-amber-500" />}
            title={t('account:prefs.themeLight')}
            subtitle={t('account:prefs.themeLightSub')}
            preview={
              <div className="mt-2 flex h-7 items-center gap-1.5 rounded-md bg-[#f8fafc] px-2.5 border border-[#e2e8f0]">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <div className="h-1.5 w-10 rounded-full bg-[#cbd5e1]" />
                <div className="h-1.5 w-6 rounded-full bg-[#e2e8f0]" />
              </div>
            }
            onClick={() => changeTheme('light')}
          />
        </div>
      </div>

      {/* Density Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="border-b border-[var(--color-border)] pb-4 mb-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconLayoutList size={16} className="text-[var(--color-accent)]" />
            {t('account:prefs.densityTitle')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:prefs.densityDesc')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <OptionCard
            selected={density === 'comfortable'}
            icon={<IconLayoutList size={18} className="text-[var(--color-text-secondary)]" />}
            title={t('account:prefs.densityComfortable')}
            subtitle={t('account:prefs.densityComfortableSub')}
            onClick={() => changeDensity('comfortable')}
          />
          <OptionCard
            selected={density === 'dense'}
            icon={<IconList size={18} className="text-[var(--color-text-secondary)]" />}
            title={t('account:prefs.densityDense')}
            subtitle={t('account:prefs.densityDenseSub')}
            onClick={() => changeDensity('dense')}
          />
        </div>
      </div>
    </div>
  )
}

function OptionCard({
  selected,
  badge,
  icon,
  title,
  subtitle,
  preview,
  onClick,
}: {
  selected: boolean
  badge?: string
  icon?: ReactNode
  title: string
  subtitle: string
  preview?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all duration-150',
        selected
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/50 shadow-xs'
          : 'border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/60 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-surface-2)]',
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {badge && (
            <span
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold font-mono transition-colors',
                selected
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-bg-surface-3)] text-[var(--color-text-secondary)]',
              )}
            >
              {badge}
            </span>
          )}
          {icon && (
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                selected
                  ? 'bg-[var(--color-accent)]/20'
                  : 'bg-[var(--color-bg-surface-3)]',
              )}
            >
              {icon}
            </div>
          )}
          <div>
            <div
              className={cn(
                'text-xs font-semibold transition-colors',
                selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]',
              )}
            >
              {title}
            </div>
            <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
              {subtitle}
            </div>
          </div>
        </div>

        <div
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all',
            selected
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
              : 'border-[var(--color-border-strong)] bg-transparent opacity-40 group-hover:opacity-100',
          )}
        >
          {selected && <IconCheck size={10} stroke={3} />}
        </div>
      </div>

      {preview && <div className="w-full">{preview}</div>}
    </button>
  )
}
