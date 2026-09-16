import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconMail, IconLock, IconEye, IconEyeOff, IconUser } from '@tabler/icons-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { FormField } from '@/components/auth/FormField'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { AuthBanner } from '@/components/auth/AuthBanner'
import { PasswordStrength } from '@/components/auth/PasswordStrength'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useRegister } from '@/hooks/useAuth'
import { isValidEmail } from '@/lib/validation'
import { cn } from '@/lib/cn'
import { ApiError } from '@/types/api'
import { featureFlags } from '@/config/featureFlags'

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'common'])
  useDocumentTitle(t('auth:register.pageTitle'))
  const register = useRegister()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; password?: string }>({})
  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; message: string } | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setBanner(null)
    const next: typeof errors = {}

    if (!fullName.trim()) next.fullName = t('auth:error.nameRequired')
    if (!email.trim()) next.email = t('auth:error.emailRequired')
    else if (!isValidEmail(email.trim())) next.email = t('auth:error.emailInvalid')
    if (!password || password.length < 8) next.password = t('auth:error.passwordWeak')

    setErrors(next)

    if (!agree) {
      setBanner({ variant: 'error', message: t('auth:error.termsRequired') })
    }

    if (Object.keys(next).length > 0 || !agree) return

    register.mutate(
      { email: email.trim(), password, fullName: fullName.trim() },
      {
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.fieldErrors?.email) setErrors((e) => ({ ...e, email: err.fieldErrors!.email }))
            if (err.fieldErrors?.password)
              setErrors((e) => ({ ...e, password: err.fieldErrors!.password }))
            if (err.fieldErrors?.fullName)
              setErrors((e) => ({ ...e, fullName: err.fieldErrors!.fullName }))
            setBanner({
              variant: 'error',
              message: err.message || t('auth:error.registerFailed'),
            })
          } else {
            setBanner({ variant: 'error', message: t('auth:error.registerFailed') })
          }
        },
      },
    )
  }

  return (
    <AuthLayout>
      <h2 className="mb-2 text-[30px] font-bold tracking-tight text-[var(--color-text-primary)]">
        {t('auth:register.title')}
      </h2>
      <p className="mb-8 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {t('auth:register.subtitle')}{' '}
        <Link to="/login" className="font-semibold text-[var(--color-accent)] no-underline hover:underline">
          {t('auth:register.cta')}
        </Link>
      </p>

      {banner && <AuthBanner variant={banner.variant} message={banner.message} />}

      <GoogleButton
        mode="register"
        onClick={
          featureFlags.googleAuth
            ? undefined
            : () => setBanner({ variant: 'info', message: t('auth:google.note') })
        }
      />

      {!featureFlags.googleAuth && (
        <div className="mt-2.5 rounded-[9px] border border-dashed border-amber-400/35 bg-amber-400/8 px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
          <strong className="font-semibold">Google: </strong>
          {t('auth:google.note')}
        </div>
      )}

      <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        <div className="h-px flex-1 bg-[var(--color-border)]" />
        <span>{t('common:or')}</span>
        <div className="h-px flex-1 bg-[var(--color-border)]" />
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <FormField
          label={t('auth:name.label')}
          type="text"
          name="fullName"
          autoComplete="name"
          placeholder={t('auth:name.placeholder')}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
          leftIcon={<IconUser size={17} />}
        />

        <FormField
          label={t('auth:email.label')}
          type="email"
          name="email"
          autoComplete="email"
          placeholder={t('auth:email.placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          leftIcon={<IconMail size={17} />}
        />

        <FormField
          label={t('auth:password.label')}
          type={showPw ? 'text' : 'password'}
          name="password"
          autoComplete="new-password"
          placeholder={t('auth:password.placeholderNew')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          leftIcon={<IconLock size={17} />}
          rightSlot={
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="cursor-pointer rounded-md border-none bg-transparent p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          }
        />
        <div className="-mt-3 mb-[18px]">
          <PasswordStrength password={password} />
        </div>

        <div className="mb-[22px] flex items-start justify-start text-[13px]">
          <label className="flex cursor-pointer select-none items-start gap-2 text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span
              className={cn(
                'mt-0.5 inline-flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] transition-all',
                agree && 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white',
              )}
            >
              {agree && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span>
              {t('auth:register.termsPrefix')}{' '}
              <button
                type="button"
                className="cursor-pointer border-none bg-transparent font-medium text-[var(--color-accent)] hover:underline"
                onClick={() => setBanner({ variant: 'info', message: t('auth:termsPhase2') })}
              >
                {t('auth:register.termsLink')}
              </button>
            </span>
          </label>
        </div>

        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => {
              const rand = Math.floor(100 + Math.random() * 900)
              setFullName(`Thành Viên Mới ${rand}`)
              setEmail(`newuser${rand}@transflow.io`)
              setPassword('TransFlow@2026')
              setAgree(true)
              setErrors({})
            }}
            className="flex cursor-pointer items-center gap-1 border-none bg-transparent text-xs font-medium text-[var(--color-accent)] hover:underline"
          >
            <span>⚡ Điền nhanh tài khoản mới (Demo)</span>
          </button>
        </div>

        <button
          type="submit"
          disabled={register.isPending}
          className="relative flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border-none bg-[var(--color-accent)] px-4 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-[var(--color-accent-hover)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {register.isPending && <span className="auth-spinner" />}
          <span>
            {register.isPending ? t('auth:register.submitting') : t('auth:register.submit')}
          </span>
        </button>
      </form>

      <div className="mt-7 border-t border-[var(--color-border)] pt-6 text-center text-xs leading-relaxed text-[var(--color-text-tertiary)]">
        <div>{t('auth:footer.copy')}</div>
        <div className="mt-1">
          <button type="button" className="cursor-pointer border-none bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            {t('common:privacy')}
          </button>
          {' · '}
          <button type="button" className="cursor-pointer border-none bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            {t('common:terms')}
          </button>
          {' · '}
          <button type="button" className="cursor-pointer border-none bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
            {t('common:help')}
          </button>
        </div>
      </div>
    </AuthLayout>
  )
}
