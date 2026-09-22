import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { can, type PermissionAction, type Role } from '@/lib/permissions'

type RoleGuardProps = {
  /** Preferred: permission action from the central matrix. */
  action?: PermissionAction
  /** Fallback: explicit roles list. */
  roles?: Role[]
  children: ReactNode
  /** When denied, redirect here instead of 403 page. */
  fallbackTo?: string
}

/**
 * Route/section guard (09b A.5.3). UX only — API 403 remains source of truth.
 */
export function RoleGuard({ action, roles, children, fallbackTo }: RoleGuardProps) {
  const { t } = useTranslation('common')
  const role = useAuthStore((s) => s.role)
  const workspaceId = useAuthStore((s) => s.currentWorkspace?.id)

  let allowed = false
  if (action) allowed = can(role, action)
  else if (roles?.length) allowed = !!role && roles.includes(role)

  if (!allowed) {
    if (fallbackTo) return <Navigate to={fallbackTo} replace />
    if (workspaceId) return <Navigate to={`/w/${workspaceId}`} replace />
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">403</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('error.forbidden')}</p>
      </div>
    )
  }

  return <>{children}</>
}
