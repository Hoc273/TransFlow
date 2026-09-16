import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuthStore, getLastWorkspaceId } from '@/store/authStore'
import { usePlatformMe } from '@/hooks/usePlatform'

/**
 * Gates `/platform/*` (09b P.0). Workspace Admin is not enough — requires
 * users.is_platform_admin from DB (refreshed via GET /auth/me).
 */
export function PlatformAdminGuard() {
  const { t } = useTranslation('platform')
  const location = useLocation()
  const accessToken = useAuthStore((s) => s.accessToken)
  const storedAdmin = useAuthStore((s) => s.user?.isPlatformAdmin === true)

  const { data: me, isLoading, isFetching, isError } = usePlatformMe(!!accessToken)

  const isDev = import.meta.env.DEV

  if (!accessToken && !isDev) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  if (!isDev && (isLoading || (isFetching && !me && !storedAdmin))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-app)] text-sm text-[var(--color-text-secondary)]">
        {t('guard.loading')}
      </div>
    )
  }

  const isAdmin = isDev || me?.isPlatformAdmin === true || (isError && storedAdmin) || storedAdmin

  if (!isAdmin) {
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
