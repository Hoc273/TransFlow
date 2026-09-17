import { useState, useEffect, useRef, type FormEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconMail,
  IconArrowLeft,
  IconCheck,
  IconLock,
  IconEye,
  IconEyeOff,
  IconShieldCheck,
  IconCircleCheck,
} from '@tabler/icons-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { FormField } from '@/components/auth/FormField'
import { AuthBanner } from '@/components/auth/AuthBanner'
import { PasswordStrength } from '@/components/auth/PasswordStrength'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useSendPasswordResetOtp,
  useVerifyPasswordResetOtp,
  useResetPasswordWithOtp,
} from '@/hooks/useAuth'
import { isValidEmail } from '@/lib/validation'
import { ApiError } from '@/types/api'

type Step = 1 | 2 | 3 | 4

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common'])
  useDocumentTitle(t('auth:forgot.pageTitle'))

  const sendOtpMutation = useSendPasswordResetOtp()
  const verifyOtpMutation = useVerifyPasswordResetOtp()
  const resetMutation = useResetPasswordWithOtp()

  const [step, setStep] = useState<Step>(1)
  const [email, setEmail] = useState('')
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', ''])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [emailError, setEmailError] = useState<string | undefined>()
  const [otpError, setOtpError] = useState<string | undefined>()
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | undefined>()

  const [banner, setBanner] = useState<{ variant: 'error' | 'info'; message: string } | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const otpInputsRef = useRef<Array<HTMLInputElement | null>>([])

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  // Step 1: Request OTP
  const handleRequestOtp = (e: FormEvent) => {
    e.preventDefault()
    setBanner(null)
    const trimmedEmail = email.trim()

    if (!trimmedEmail) {
      setEmailError(t('auth:error.emailRequired'))
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      setEmailError(t('auth:error.emailInvalid'))
      return
    }

    setEmailError(undefined)

    sendOtpMutation.mutate(trimmedEmail, {
      onSuccess: () => {
        setStep(2)
        setCooldown(60)
        setBanner({ variant: 'info', message: `${t('auth:forgot.step2Subtitle')} ${trimmedEmail}` })
        setTimeout(() => {
          otpInputsRef.current[0]?.focus()
        }, 100)
      },
      onError: (err) => {
        if (err instanceof ApiError && err.message) {
          setBanner({ variant: 'error', message: err.message })
        } else {
          setBanner({ variant: 'error', message: t('auth:error.loginFailed') })
        }
      },
    })
  }

  // Resend OTP
  const handleResendOtp = () => {
    if (cooldown > 0 || sendOtpMutation.isPending) return
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return

    sendOtpMutation.mutate(trimmedEmail, {
      onSuccess: () => {
        setCooldown(60)
        setBanner({ variant: 'info', message: t('auth:forgot.resendSuccess') })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.message) {
          setBanner({ variant: 'error', message: err.message })
        }
      },
    })
  }

  // OTP inputs handling
  const handleOtpChange = (index: number, val: string) => {
    const char = val.slice(-1)
    if (char && !/^\d$/.test(char)) return

    const next = [...otpDigits]
    next[index] = char
    setOtpDigits(next)
    setOtpError(undefined)

    if (char && index < 5) {
      otpInputsRef.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').trim()
    const digits = pasted.replace(/\D/g, '').slice(0, 6).split('')
    if (digits.length === 0) return

    const next = [...otpDigits]
    digits.forEach((d, i) => {
      if (i < 6) next[i] = d
    })
    setOtpDigits(next)
    setOtpError(undefined)

    const nextFocusIndex = Math.min(digits.length, 5)
    otpInputsRef.current[nextFocusIndex]?.focus()
  }

  // Step 2: Verify OTP
  const handleVerifyOtp = (e: FormEvent) => {
    e.preventDefault()
    setBanner(null)
    const code = otpDigits.join('')

    if (code.length < 6) {
      setOtpError(t('auth:forgot.errorOtpInvalid'))
      return
    }

    setOtpError(undefined)

    verifyOtpMutation.mutate(
      { email: email.trim(), otp: code },
      {
        onSuccess: () => {
          setStep(3)
        },
        onError: (err) => {
          if (err instanceof ApiError && err.message) {
            setOtpError(err.message)
            setBanner({ variant: 'error', message: err.message })
          } else {
            setOtpError(t('auth:forgot.errorOtpInvalid'))
          }
        },
      },
    )
  }

  // Step 3: Reset Password
  const handleResetPassword = (e: FormEvent) => {
    e.preventDefault()
    setBanner(null)
    let hasErr = false

    if (!newPassword) {
      setPasswordError(t('auth:error.passwordRequired'))
      hasErr = true
    } else if (newPassword.length < 8) {
      setPasswordError(t('auth:error.passwordWeak'))
      hasErr = true
    } else {
      setPasswordError(undefined)
    }

    if (!confirmPassword) {
      setConfirmPasswordError(t('auth:error.passwordRequired'))
      hasErr = true
    } else if (newPassword !== confirmPassword) {
      setConfirmPasswordError(t('auth:forgot.errorPasswordMismatch'))
      hasErr = true
    } else {
      setConfirmPasswordError(undefined)
    }

    if (hasErr) return

    resetMutation.mutate(
      {
        email: email.trim(),
        otp: otpDigits.join(''),
        newPassword,
      },
      {
        onSuccess: () => {
          setStep(4)
        },
        onError: (err) => {
          if (err instanceof ApiError && err.message) {
            setBanner({ variant: 'error', message: err.message })
          } else {
            setBanner({ variant: 'error', message: t('auth:error.loginFailed') })
          }
        },
      },
    )
  }

  return (
    <AuthLayout>
      {/* Mini Step Tracker (when not on success step) */}
      {step < 4 && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)] mb-2">
            <span>{t('auth:forgot.stepIndicator', { current: step, total: 3 })}</span>
            <span className="font-semibold text-[var(--color-accent)]">
              {step === 1
                ? t('auth:forgot.step1Title')
                : step === 2
                  ? t('auth:forgot.step2Title')
                  : t('auth:forgot.step3Title')}
            </span>
          </div>

          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                  s < step
                    ? 'bg-emerald-500'
                    : s === step
                      ? 'bg-[var(--color-accent)]'
                      : 'bg-[var(--color-border)]'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {banner && <AuthBanner variant={banner.variant} message={banner.message} />}

      {/* ============================================================ */}
      {/* STEP 1: NHẬP EMAIL ĐỂ GỬI MÃ OTP                            */}
      {/* ============================================================ */}
      {step === 1 && (
        <div>
          <h2 className="mb-2 text-[28px] font-bold tracking-tight text-[var(--color-text-primary)]">
            {t('auth:forgot.step1Title')}
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {t('auth:forgot.step1Subtitle')}
          </p>

          <form onSubmit={handleRequestOtp} noValidate>
            <FormField
              label={t('auth:email.label')}
              type="email"
              name="email"
              autoComplete="email"
              placeholder={t('auth:email.placeholder')}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (emailError) setEmailError(undefined)
              }}
              error={emailError}
              leftIcon={<IconMail size={17} />}
              autoFocus
            />

            <button
              type="submit"
              disabled={sendOtpMutation.isPending}
              className="mt-2 relative flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border-none bg-[var(--color-accent)] px-4 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-[var(--color-accent-hover)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendOtpMutation.isPending ? (
                <>
                  <span className="auth-spinner" />
                  <span>{t('auth:forgot.step1Submitting')}</span>
                </>
              ) : (
                <>
                  <IconShieldCheck size={18} />
                  <span>{t('auth:forgot.step1Submit')}</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-secondary)] no-underline transition hover:text-[var(--color-accent)]"
            >
              <IconArrowLeft size={15} />
              <span>{t('auth:forgot.backToLogin')}</span>
            </Link>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 2: XÁC THỰC MÃ OTP 6 CHỮ SỐ                             */}
      {/* ============================================================ */}
      {step === 2 && (
        <div>
          <h2 className="mb-2 text-[28px] font-bold tracking-tight text-[var(--color-text-primary)]">
            {t('auth:forgot.step2Title')}
          </h2>
          <div className="mb-6 flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
            <span>{t('auth:forgot.step2Subtitle')}</span>
            <span className="font-semibold text-[var(--color-text-primary)]">{email}</span>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="ml-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              ({t('auth:forgot.changeEmail')})
            </button>
          </div>

          <form onSubmit={handleVerifyOtp} noValidate>
            <div className="mb-6">
              <label className="mb-2.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                {t('auth:forgot.otpLabel')}
              </label>

              {/* 6-box OTP digits */}
              <div className="flex items-center justify-between gap-2 sm:gap-3" onPaste={handleOtpPaste}>
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpInputsRef.current[idx] = el
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className={`h-13 w-11 sm:h-14 sm:w-12 rounded-xl border text-center font-mono text-xl font-bold transition-all outline-none ${
                      otpError
                        ? 'border-red-500 bg-red-500/5 text-red-500'
                        : digit
                          ? 'border-[var(--color-accent)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] ring-2 ring-[var(--color-accent)]/20'
                          : 'border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20'
                    }`}
                  />
                ))}
              </div>

              {otpError && (
                <div className="mt-2 text-xs font-medium text-red-500">{otpError}</div>
              )}
            </div>

            <button
              type="submit"
              disabled={verifyOtpMutation.isPending || otpDigits.join('').length < 6}
              className="relative flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border-none bg-[var(--color-accent)] px-4 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-[var(--color-accent-hover)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifyOtpMutation.isPending ? (
                <>
                  <span className="auth-spinner" />
                  <span>{t('auth:forgot.step2Submitting')}</span>
                </>
              ) : (
                <>
                  <IconCheck size={18} />
                  <span>{t('auth:forgot.step2Submit')}</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-1 hover:text-[var(--color-text-primary)]"
            >
              <IconArrowLeft size={14} />
              <span>{t('auth:forgot.back')}</span>
            </button>

            <button
              type="button"
              disabled={cooldown > 0 || sendOtpMutation.isPending}
              onClick={handleResendOtp}
              className="font-medium text-[var(--color-accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {cooldown > 0
                ? t('auth:forgot.resendCooldown', { seconds: cooldown })
                : t('auth:forgot.resend')}
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 3: TẠO MẬT KHẨU MỚI                                    */}
      {/* ============================================================ */}
      {step === 3 && (
        <div>
          <h2 className="mb-2 text-[28px] font-bold tracking-tight text-[var(--color-text-primary)]">
            {t('auth:forgot.step3Title')}
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {t('auth:forgot.step3Subtitle')}
          </p>

          <form onSubmit={handleResetPassword} noValidate>
            <FormField
              label={t('auth:forgot.newPasswordLabel')}
              type={showPassword ? 'text' : 'password'}
              name="newPassword"
              autoComplete="new-password"
              placeholder={t('auth:password.placeholderNew')}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value)
                if (passwordError) setPasswordError(undefined)
              }}
              error={passwordError}
              leftIcon={<IconLock size={17} />}
              rightSlot={
                <button
                  type="button"
                  tabIndex={-1}
                  className="cursor-pointer border-none bg-transparent p-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                </button>
              }
              autoFocus
            />

            <PasswordStrength password={newPassword} />

            <div className="mt-4">
              <FormField
                label={t('auth:forgot.confirmPasswordLabel')}
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                autoComplete="new-password"
                placeholder={t('auth:forgot.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  if (confirmPasswordError) setConfirmPasswordError(undefined)
                }}
                error={confirmPasswordError}
                leftIcon={<IconLock size={17} />}
                rightSlot={
                  <button
                    type="button"
                    tabIndex={-1}
                    className="cursor-pointer border-none bg-transparent p-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                    onClick={() => setShowConfirmPassword((s) => !s)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                  </button>
                }
              />
            </div>

            <button
              type="submit"
              disabled={resetMutation.isPending}
              className="mt-4 relative flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border-none bg-[var(--color-accent)] px-4 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-[var(--color-accent-hover)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resetMutation.isPending ? (
                <>
                  <span className="auth-spinner" />
                  <span>{t('auth:forgot.step3Submitting')}</span>
                </>
              ) : (
                <>
                  <IconCheck size={18} />
                  <span>{t('auth:forgot.step3Submit')}</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <IconArrowLeft size={14} />
              <span>{t('auth:forgot.back')}</span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 4: HOÀN TẤT - THÀNH CÔNG                                */}
      {/* ============================================================ */}
      {step === 4 && (
        <div className="py-4 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 ring-8 ring-emerald-500/5 animate-in zoom-in-75 duration-300">
            <IconCircleCheck size={36} />
          </div>

          <h2 className="mb-2 text-[26px] font-bold tracking-tight text-[var(--color-text-primary)]">
            {t('auth:forgot.successTitle')}
          </h2>

          <p className="mb-8 text-sm leading-relaxed text-[var(--color-text-secondary)]">
            {t('auth:forgot.successMessage')}
          </p>

          <Link
            to="/login"
            className="flex w-full items-center justify-center gap-2 rounded-[11px] bg-[var(--color-accent)] px-4 py-3.5 text-sm font-semibold text-white no-underline transition hover:bg-[var(--color-accent-hover)] shadow-sm hover:shadow-[0_6px_20px_rgba(99,102,241,0.28)]"
          >
            <span>{t('auth:forgot.loginNow')}</span>
          </Link>
        </div>
      )}
    </AuthLayout>
  )
}
