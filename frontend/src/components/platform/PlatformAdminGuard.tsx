import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuthStore, getLastWorkspaceId } from '@/store/authStore'
import { usePlatformMe } from '@/hooks/usePlatform'

/**
 * Gates `/platform/*` (09b P.0). Workspace Admin is not enough — requires
 * users.is_platform_admin from DB (refreshed via GET /auth/me). Applies in dev too:
 * the shell is never rendered for a non-admin. The API enforces the same rule (403),
 * so this only keeps the admin UI out of sight.
 */
export function PlatformAdminGuard() {
  const { t } = useTranslation('platform')
  const location = useLocation()
  const accessToken = useAuthStore((s) => s.accessToken)
  // Only an answer fetched after entering /platform counts: cached `me` (query cache or the
  // persisted store) may predate a demotion, so it never opens the shell on its own.
  const [enteredAt] = useState(() => Date.now())

  const { data: me, dataUpdatedAt, isError, refetch } = usePlatformMe(!!accessToken, true)

  if (!accessToken) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  const confirmed = !!me && dataUpdatedAt >= enteredAt

  if (!confirmed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-bg-app)] text-sm text-[var(--color-text-secondary)]">
        {isError ? t('guard.checkFailed') : t('guard.loading')}
        {isError && (
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        )}
      </div>
    )
  }

  if (me.isPlatformAdmin !== true) {
    return <PlatformForbidden />
  }

  return <Outlet />
}

function PlatformForbidden() {
  const { t } = useTranslation('platform')
  const lastWs = getLastWorkspaceId()
  const back = lastWs ? `/w/${lastWs}` : '/dashboard'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] px-4 text-center">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-8 py-10 shadow-sm max-w-md">
        <div className="text-4xl font-bold text-[var(--color-error)] mb-2">403</div>
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {t('guard.forbiddenTitle')}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('guard.forbiddenBody')}</p>
        <Link to={back} className="btn-primary mt-6 inline-flex">
          {t('backToApp')}
        </Link>
      </div>
    </div>
  )
}
