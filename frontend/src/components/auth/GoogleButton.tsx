import { useTranslation } from 'react-i18next'
import { featureFlags, apiBaseUrl } from '@/config/featureFlags'

interface GoogleButtonProps {
  mode: 'login' | 'register'
  /**
   * Optional override. Default: flag off → caller may show banner;
   * flag on → navigate to BE start URL (09b B.1b / 07 Q-AUTH-G3).
   */
  onClick?: () => void
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
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

/**
 * Google sign-in/up entry (docs/07 Q-AUTH-G*, 09b §B.1b).
 * - `VITE_ENABLE_GOOGLE_AUTH=false` (default): UI only — parent shows info banner; no fake JWT.
 * - `true`: full-page navigate to backend-mediated OAuth start.
 */
export function GoogleButton({ mode, onClick }: GoogleButtonProps) {
  const { t } = useTranslation('auth')

  const handleClick = () => {
    if (onClick) {
      onClick()
      return
    }
    if (!featureFlags.googleAuth) return
    const params = new URLSearchParams({ mode })
    window.location.assign(`${apiBaseUrl}/auth/google/start?${params.toString()}`)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] transition-all hover:-translate-y-px hover:border-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface-2)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)] active:translate-y-0"
    >
      <GoogleIcon />
      <span>{mode === 'login' ? t('google.continue') : t('google.signup')}</span>
    </button>
  )
}
