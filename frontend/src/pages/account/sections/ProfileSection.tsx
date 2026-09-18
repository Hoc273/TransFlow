import { useEffect, useState, type FormEvent } from 'react'
import {
  IconAlertCircle,
  IconCheck,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLock,
  IconUpload,
  IconUser,
  IconWorld,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { initialsFromName } from '@/lib/format'

const TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Tokyo',
  'America/New_York',
  'Europe/London',
] as const

const DISPLAY_NAME_KEY = 'tf-display-name'
const TIMEZONE_KEY = 'tf-timezone'

function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

/**
 * Profile Section — Sleek, High-end SaaS profile layout.
 */
export function ProfileSection() {
  const { t } = useTranslation(['account', 'common'])
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [displayName, setDisplayName] = useState(() => readLocal(DISPLAY_NAME_KEY))
  const [timezone, setTimezone] = useState(
    () => readLocal(TIMEZONE_KEY) || 'Asia/Ho_Chi_Minh',
  )
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<'success' | 'info' | null>(null)
  const [avatarNote, setAvatarNote] = useState(false)

  useEffect(() => {
    setFullName(user?.fullName ?? '')
  }, [user?.fullName])

  const initials = user ? initialsFromName(user.fullName) : 'TF'
  const email = user?.email ?? ''

  const onReset = () => {
    setFullName(user?.fullName ?? '')
    setDisplayName(readLocal(DISPLAY_NAME_KEY))
    setTimezone(readLocal(TIMEZONE_KEY) || 'Asia/Ho_Chi_Minh')
    setError(null)
    setBanner(null)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBanner(null)
    const trimmed = fullName.trim()
    if (!trimmed) {
      setError(t('account:profile.fullNameRequired'))
      return
    }

    if (user) {
      setUser({ ...user, fullName: trimmed })
    }
    try {
      localStorage.setItem(DISPLAY_NAME_KEY, displayName.trim())
      localStorage.setItem(TIMEZONE_KEY, timezone)
    } catch {
      /* ignore quota */
    }
    setBanner('success')
    window.setTimeout(() => setBanner(null), 4000)
  }

  return (
    <div className="space-y-6">
      {/* Avatar & Identity Banner Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-tr from-[#714ffc] to-[#a855f7] text-xl font-bold text-white shadow-md shadow-[#714ffc]/20 ring-2 ring-[var(--color-bg-surface)]">
                {initials}
              </div>
              <button
                type="button"
                onClick={() => setAvatarNote(true)}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-bg-surface-3)] text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-accent)] hover:text-white transition"
                title={t('account:profile.avatarUpload')}
              >
                <IconUpload size={12} />
              </button>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                  {user?.fullName || t('common:user.demoName')}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  <IconCheck size={10} stroke={2.5} />
                  <span>Active</span>
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{email}</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('account:profile.avatarHint')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              className="btn-secondary btn-sm flex items-center gap-1.5"
              onClick={() => setAvatarNote(true)}
            >
              <IconUpload size={13} />
              <span>{t('account:profile.avatarUpload')}</span>
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
              onClick={() => setAvatarNote(true)}
            >
              <span>{t('account:profile.avatarRemove')}</span>
            </button>
          </div>
        </div>

        {avatarNote && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] px-3.5 py-2.5 text-xs text-[var(--color-accent)]">
            <IconInfoCircle size={15} className="shrink-0" />
            <span>{t('account:profile.avatarPending')}</span>
          </div>
        )}
      </div>

      {/* Main Profile Form Card */}
      <form onSubmit={onSubmit} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="border-b border-[var(--color-border)] pb-4 mb-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconUser size={16} className="text-[var(--color-accent)]" />
            {t('account:profile.title')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:profile.desc')}
          </p>
        </div>

        {banner === 'success' && (
          <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400 animate-in fade-in">
            <IconCheck size={16} className="shrink-0" />
            <div>
              <div className="font-semibold">{t('account:profile.saveSuccess')}</div>
              <div className="opacity-80 text-[11px] mt-0.5">{t('account:profile.saveLocal')}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1" htmlFor="profile-fullName">
              <span>{t('account:profile.fullName')}</span>
              <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              id="profile-fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('account:profile.fullNamePh')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-hidden transition"
              autoComplete="name"
            />
            {error && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-error)] mt-1">
                <IconAlertCircle size={12} />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center justify-between" htmlFor="profile-displayName">
              <span>{t('account:profile.displayName')}</span>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">Optional</span>
            </label>
            <input
              id="profile-displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-hidden transition"
            />
            <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('account:profile.displayNameHelp')}</p>
          </div>

          {/* Email (Read-only) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5" htmlFor="profile-email">
              <IconLock size={12} className="text-[var(--color-text-tertiary)]" />
              <span>{t('account:profile.email')}</span>
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              readOnly
              className="w-full cursor-not-allowed rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-3)] px-3 py-2 text-xs text-[var(--color-text-secondary)] opacity-80"
            />
            <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('account:profile.emailHelp')}</p>
          </div>

          {/* Timezone */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5" htmlFor="profile-tz">
              <IconWorld size={12} className="text-[var(--color-text-tertiary)]" />
              <span>{t('account:profile.timezone')}</span>
            </label>
            <select
              id="profile-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-hidden transition"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {t(`account:tz.${tz}`)}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">Affects timestamps and scheduled batch jobs.</p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="mt-8 flex items-center justify-end gap-3 border-t border-[var(--color-border)] pt-5">
          <button
            type="button"
            className="btn-ghost btn-sm text-xs"
            onClick={onReset}
          >
            {t('account:common.cancel')}
          </button>
          <button
            type="submit"
            className="btn-primary btn-sm flex items-center gap-1.5 text-xs shadow-xs"
          >
            <IconDeviceFloppy size={14} />
            <span>{t('account:common.save')}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
