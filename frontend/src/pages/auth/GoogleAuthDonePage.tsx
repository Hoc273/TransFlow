import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useAuthStore } from '@/store/authStore'
import { resolvePostAuthPath } from '@/hooks/useAuth'
import { googleExchangeApi } from '@/api/auth'
import { featureFlags } from '@/config/featureFlags'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthBanner } from '@/components/auth/AuthBanner'
import { ApiError } from '@/types/api'

/**
 * OAuth return page (09b B.1b / 07 Q-AUTH-G3).
 * Active only when BE Auth-OAuth ships + VITE_ENABLE_GOOGLE_AUTH=true.
 */
export function GoogleAuthDonePage() {
  const { t } = useTranslation(['auth', 'common'])
  useDocumentTitle(t('auth:google.doneTitle'))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!featureFlags.googleAuth) {
        setError(t('auth:google.notEnabled'))
        setBusy(false)
        return
      }

      const errCode = params.get('error')
      if (errCode) {
        const key = `auth:google.error.${errCode}` as const
        const msg = t(key, { defaultValue: t('auth:google.error.google_failed') })
        setError(msg)
        setBusy(false)
        return
      }

      const code = params.get('code')
      if (!code) {
        setError(t('auth:google.error.google_failed'))
        setBusy(false)
        return
      }

      try {
        const data = await googleExchangeApi(code)
        if (cancelled) return
        setSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        })
        const path = await resolvePostAuthPath()
        if (!cancelled) navigate(path, { replace: true })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof ApiError ? e.message : t('auth:google.error.google_failed'))
        setBusy(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [params, navigate, setSession, t])

  return (
    <AuthLayout>
      <h2 className="mb-2 text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
        {t('auth:google.doneTitle')}
      </h2>
      {busy && !error && (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('auth:google.completing')}</p>
      )}
      {error && (
        <>
          <AuthBanner variant="error" message={error} />
          <Link
            to="/login"
            className="mt-4 inline-block text-sm font-semibold text-[var(--color-accent)] no-underline hover:underline"
          >
            {t('auth:register.cta')}
          </Link>
        </>
      )}
    </AuthLayout>
  )
}
