import { apiRequest } from '@/lib/api/client'
import type {
  PlatformAuditLogItem,
  PlatformAuditQuery,
  PlatformOverview,
  PlatformOverviewQuery,
  PlatformPage,
  PlatformStatus,
  PlatformUserItem,
  PlatformUsersQuery,
  PlatformWorkspaceItem,
  PlatformWorkspacesQuery,
} from '@/types/platform'

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    search.set(k, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

/** SA1 — 6 KPI overview. */
export function getPlatformOverviewApi(query: PlatformOverviewQuery = {}) {
  return apiRequest<PlatformOverview>(
    `/platform/overview${qs({
      from: query.from,
      to: query.to,
      topLimit: query.topLimit,
    })}`,
  )
}

/** SA2 — 6 core service health. */
export function getPlatformStatusApi() {
  return apiRequest<PlatformStatus>('/platform/status')
}

/** SA3 — user directory (metadata only). */
export function getPlatformUsersApi(query: PlatformUsersQuery = {}) {
  return apiRequest<PlatformPage<PlatformUserItem>>(
    `/platform/users${qs({
      q: query.q,
      page: query.page,
      size: query.size,
      isPlatformAdmin: query.isPlatformAdmin,
    })}`,
  )
}

/** SA3 — workspace directory (metadata only). */
export function getPlatformWorkspacesApi(query: PlatformWorkspacesQuery = {}) {
  return apiRequest<PlatformPage<PlatformWorkspaceItem>>(
    `/platform/workspaces${qs({
      q: query.q,
      page: query.page,
      size: query.size,
    })}`,
  )
}

/** SA4 — Super Admin audit self-read. */
export function getPlatformAuditLogsApi(query: PlatformAuditQuery = {}) {
  return apiRequest<PlatformPage<PlatformAuditLogItem>>(
    `/platform/audit-logs${qs({
      action: query.action,
      page: query.page,
      size: query.size,
    })}`,
  )
}
