import { apiRequest } from '@/lib/api/client'
import type {
  AuditLog,
  PlatformOverview,
  PlatformPage,
  PlatformStatus,
  PlatformUser,
  PlatformWorkspace,
} from '@/types/platform'

function qs(params: Record<string, string | number | boolean | undefined>) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') s.set(k, String(v))
  }
  const str = s.toString()
  return str ? `?${str}` : ''
}

export function getPlatformOverviewApi(params: { from?: string; to?: string; topLimit?: number } = {}) {
  return apiRequest<PlatformOverview>(`/platform/overview${qs(params)}`)
}

export function getPlatformStatusApi() {
  return apiRequest<PlatformStatus>('/platform/status')
}

export function getPlatformUsersApi(
  params: { q?: string; page?: number; size?: number; isPlatformAdmin?: boolean } = {},
) {
  return apiRequest<PlatformPage<PlatformUser>>(`/platform/users${qs(params)}`)
}

export function getPlatformWorkspacesApi(params: { q?: string; page?: number; size?: number } = {}) {
  return apiRequest<PlatformPage<PlatformWorkspace>>(`/platform/workspaces${qs(params)}`)
}

export function getPlatformAuditLogsApi(params: { action?: string; page?: number; size?: number } = {}) {
  return apiRequest<PlatformPage<AuditLog>>(`/platform/audit-logs${qs(params)}`)
}
