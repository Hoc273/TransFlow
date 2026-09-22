import { useState, type FormEvent } from 'react'
import {
  IconAlertCircle,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconInfoCircle,
  IconKey,
  IconLoader2,
  IconLock,
  IconShieldCheck,
  IconShieldLock,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { featureFlags, apiBaseUrl } from '@/config/featureFlags'
import { scorePassword } from '@/lib/validation'
import { useChangePassword, useMe } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/types/api'
import { cn } from '@/lib/cn'

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function PwField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
  placeholder = '••••••••',
  rightBadge,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  autoComplete: string
  placeholder?: string
  rightBadge?: React.ReactNode
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label
          className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)]"
          htmlFor={id}
        >
          <span>{label}</span>
          <span className="font-semibold text-[var(--color-error)]">*</span>
        </label>
        {rightBadge}
      </div>
      <div className="relative flex items-center">
        <div className="pointer-events-none absolute left-3 flex items-center text-[var(--color-text-tertiary)]">
          <IconLock size={15} stroke={1.75} />
        </div>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] pl-9.5 pr-9 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] transition focus:border-[var(--color-accent)] focus:outline-hidden focus:ring-2 focus:ring-[var(--color-accent)]/20',
            error &&
              'border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-[var(--color-error)]/20',
          )}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition cursor-pointer"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <IconEyeOff size={15} /> : <IconEye size={15} />}
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-error)] mt-1 animate-in fade-in">
          <IconAlertCircle size={13} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Security Section — Enterprise-grade credentials & authentication controls.
 */
export function SecuritySection() {
  const { t } = useTranslation(['account', 'common', 'auth'])
  const changePassword = useChangePassword()
  useMe()

  const user = useAuthStore((s) => s.user)
  const isGoogleLinked = Boolean(user?.googleLinked)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [info, setInfo] = useState<string | null>(null)
  const [oauthNote, setOauthNote] = useState<string | null>(null)

  const { hasLen, hasUpper, hasNum } = scorePassword(newPw)
  const matches = Boolean(newPw && confirmPw && newPw === confirmPw)

  const onResetForm = () => {
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setErrors({})
    setInfo(null)
  }

  const onPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setInfo(null)
    const next: Record<string, string> = {}
    if (!currentPw) next.current = t('account:security.required')
    if (newPw.length < 8) next.new = t('account:security.tooShort')
    else {
      if (!hasLen || !hasUpper || !hasNum) {
        next.new = t('auth:password.reqLen')
      }
    }
    if (newPw !== confirmPw) next.confirm = t('account:security.mismatch')
    setErrors(next)
    if (Object.keys(next).length > 0) return

    try {
      await changePassword.mutateAsync({
        currentPassword: currentPw,
        newPassword: newPw,
      })
      setInfo(t('account:security.success'))
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      window.setTimeout(() => setInfo(null), 4000)
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        (err.status === 401 ||
          err.code === 'INVALID_CREDENTIALS' ||
          String(err.code) === '2001')
      ) {
        setErrors({
          current: t('auth:errors.invalidCredentials', {
            defaultValue: 'Mật khẩu hiện tại không chính xác',
          }),
        })
      } else {
        const msg =
          err instanceof Error
            ? err.message
            : t('account:security.failed', { defaultValue: 'Đổi mật khẩu thất bại' })
        setErrors({ current: msg })
      }
    }
  }

  const onGoogleConnect = () => {
    if (featureFlags.googleAuth) {
      window.location.assign(`${apiBaseUrl}/auth/google/start?mode=login`)
    } else {
      setOauthNote(t('account:security.googlePending'))
      window.setTimeout(() => setOauthNote(null), 3500)
    }
  }

  return (
    <div className="space-y-6">
      {/* Change Password Card */}
      <form
        onSubmit={onPasswordSubmit}
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs"
      >
        <div className="border-b border-[var(--color-border)] pb-4 mb-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconKey size={16} className="text-[var(--color-accent)]" />
            {t('account:security.passwordTitle')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:security.passwordDesc')}
          </p>
        </div>

        {info && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400 animate-in fade-in">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/20">
              <IconCheck size={16} className="text-emerald-400" />
            </div>
            <div>
              <div className="font-semibold text-emerald-300">{info}</div>
              <div className="text-[11px] text-emerald-400/80 mt-0.5">
                Mật khẩu đã được cập nhật an toàn trong hệ thống.
              </div>
            </div>
          </div>
        )}

        <div className="max-w-lg space-y-4">
          <PwField
            id="current-pw"
            label={t('account:security.current')}
            value={currentPw}
            onChange={setCurrentPw}
            error={errors.current}
            autoComplete="current-password"
          />

          <div className="my-1 border-t border-[var(--color-border)] opacity-60" />

          <PwField
            id="new-pw"
            label={t('account:security.new')}
            value={newPw}
            onChange={setNewPw}
            error={errors.new}
            autoComplete="new-password"
          />

          <PwField
            id="confirm-pw"
            label={t('account:security.confirm')}
            value={confirmPw}
            onChange={setConfirmPw}
            error={errors.confirm}
            autoComplete="new-password"
            rightBadge={
              confirmPw.length > 0 &&
              (matches ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500">
                  <IconCheck size={12} stroke={2.5} />
                  <span>{t('account:security.reqMatch')}</span>
                </span>
              ) : (
                <span className="text-[11px] font-medium text-[var(--color-error)]">
                  {t('account:security.mismatch')}
                </span>
              ))
            }
          />

          <div className="mt-6 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
            <button
              type="button"
              onClick={onResetForm}
              className="btn-ghost btn-sm text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              disabled={!currentPw && !newPw && !confirmPw}
            >
              {t('account:security.resetForm')}
            </button>
            <button
              type="submit"
              disabled={changePassword.isPending}
              className="btn-primary btn-sm flex items-center gap-1.5 text-xs shadow-xs cursor-pointer"
            >
              {changePassword.isPending ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconShieldLock size={14} />
              )}
              <span>
                {changePassword.isPending
                  ? t('common:saving', { defaultValue: 'Đang lưu...' })
                  : t('account:security.change')}
              </span>
            </button>
          </div>
        </div>
      </form>

      {/* Connected Accounts Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="border-b border-[var(--color-border)] pb-4 mb-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconShieldCheck size={16} className="text-[var(--color-accent)]" />
            {t('account:security.oauthTitle')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:security.oauthDesc')}
          </p>
        </div>

        {oauthNote && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] px-3.5 py-2.5 text-xs text-[var(--color-accent)]">
            <IconInfoCircle size={15} className="shrink-0" />
            <span>{oauthNote}</span>
          </div>
        )}

        <div className="divide-y divide-[var(--color-border)]">
          {/* Google */}
          <div className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] shadow-2xs">
                <GoogleMark />
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-[var(--color-text-primary)]">Google</div>
                <div className="text-[11px] text-[var(--color-text-tertiary)]">
                  {isGoogleLinked
                    ? user?.email
                      ? `${t('account:security.googleLinkedEmail')}: ${user.email}`
                      : t('account:security.googleConnected')
                    : featureFlags.googleAuth
                      ? t('account:security.googleNotConnected')
                      : t('account:security.googlePending')}
                </div>
              </div>
            </div>
            {isGoogleLinked ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 select-none">
                <IconCheck size={13} stroke={2.5} />
                <span>{t('account:security.googleConnected')}</span>
              </span>
            ) : (
              <button
                type="button"
                className="btn-secondary btn-sm text-xs cursor-pointer"
                onClick={onGoogleConnect}
              >
                {t('account:common.connect')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
