import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * Top-level gate for /platform/*. UX only — backend
 * PlatformController.assertPlatformAdmin remains the security boundary.
 */
export function PlatformGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  if (!token) return <Navigate to="/login" replace />
  if (user?.isPlatformAdmin !== true) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
