import { useAuthStore } from '@/store/authStore'
import { can, type PermissionAction } from '@/lib/permissions'

/** Central permission check (09b A.5.3). UI only — BE enforces real access. */
export function usePermission(action: PermissionAction): boolean {
  const role = useAuthStore((s) => s.role)
  return can(role, action)
}
