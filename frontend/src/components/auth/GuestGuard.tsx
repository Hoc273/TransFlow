import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore, getLastWorkspaceId } from '@/store/authStore'

/** Public auth routes: redirect signed-in users into the app. */
export function GuestGuard() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  if (accessToken) {
    const wsId = currentWorkspace?.id ?? getLastWorkspaceId()
    if (wsId) return <Navigate to={`/w/${wsId}`} replace />
    return <Navigate to="/no-workspace" replace />
  }

  return <Outlet />
}
