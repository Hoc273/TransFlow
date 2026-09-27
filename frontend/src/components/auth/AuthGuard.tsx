import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaces } from '@/hooks/useWorkspaces'

/**
 * Protects `/w/:workspaceId/*` (09b A.5.3).
 * No token → /login; unknown workspace → first workspace or /no-workspace.
 */
export function AuthGuard() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const { workspaceId } = useParams()
  const accessToken = useAuthStore((s) => s.accessToken)
  const setCurrentWorkspace = useAuthStore((s) => s.setCurrentWorkspace)
  const { data: workspaces, isLoading, isError, error, isFetching } = useWorkspaces({
    enabled: !!accessToken,
  })

  useEffect(() => {
    if (!workspaces?.length || !workspaceId) return
    const match = workspaces.find((w) => w.id === workspaceId)
    if (match) setCurrentWorkspace(match)
  }, [workspaces, workspaceId, setCurrentWorkspace])

  if (!accessToken) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }

  if (isLoading || (isFetching && !workspaces)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-app)] text-sm text-[var(--color-text-secondary)]">
        {t('loading')}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-bg-app)] px-4 text-center">
        <p className="text-sm text-[var(--color-error)]">
          {(error as Error)?.message || t('error.loadFailed')}
        </p>
        <button
          type="button"
          className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          onClick={() => window.location.reload()}
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  if (!workspaces?.length) {
    return <Navigate to="/no-workspace" replace />
  }

  if (workspaceId) {
    const match = workspaces.find((w) => w.id === workspaceId)
    if (!match) {
      return <Navigate to={`/w/${workspaces[0].id}`} replace />
    }
  }

  return <Outlet />
}
