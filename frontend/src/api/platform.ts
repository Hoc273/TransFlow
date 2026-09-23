import { apiRequest } from '@/lib/api/client'
import type {
  PlatformAuditLogItem,
  PlatformAuditQuery,
  PlatformOverview,
  PlatformOverviewQuery,
  PlatformPage,
  PlatformRealtime,
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

function normalizePage<T>(raw: unknown): PlatformPage<T> {
  const data = raw as Record<string, unknown> | null | undefined
  const list: T[] = Array.isArray(data?.content)
    ? (data.content as T[])
    : Array.isArray(data?.items)
      ? (data.items as T[])
      : []
  const total = Number(data?.totalElements ?? data?.totalItems ?? list.length ?? 0)
  return {
    content: list,
    items: list,
    page: Number(data?.page ?? 0),
    size: Number(data?.size ?? (list.length || 20)),
    totalElements: total,
    totalItems: total,
    totalPages: Number(data?.totalPages ?? (list.length > 0 ? 1 : 0)),
  }
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

/** SA-RT — live system activity snapshot (processingJobs, completedToday, tokensLastHour). */
export function getPlatformRealtimeApi() {
  return apiRequest<PlatformRealtime>('/platform/realtime')
}

/** SA3 — user directory (metadata only). */
export async function getPlatformUsersApi(
  query: PlatformUsersQuery = {},
): Promise<PlatformPage<PlatformUserItem>> {
  const res = await apiRequest<unknown>(
    `/platform/users${qs({
      q: query.q,
      page: query.page,
      size: query.size,
      isPlatformAdmin: query.isPlatformAdmin,
    })}`,
  )
  return normalizePage<PlatformUserItem>(res)
}

/** SA3 — workspace directory (metadata only). */
export async function getPlatformWorkspacesApi(
  query: PlatformWorkspacesQuery = {},
): Promise<PlatformPage<PlatformWorkspaceItem>> {
  const res = await apiRequest<unknown>(
    `/platform/workspaces${qs({
      q: query.q,
      page: query.page,
      size: query.size,
    })}`,
  )
  return normalizePage<PlatformWorkspaceItem>(res)
}

/** SA4 — Super Admin audit self-read. */
export async function getPlatformAuditLogsApi(
  query: PlatformAuditQuery = {},
): Promise<PlatformPage<PlatformAuditLogItem>> {
  const res = await apiRequest<unknown>(
    `/platform/audit-logs${qs({
      action: query.action,
      page: query.page,
      size: query.size,
    })}`,
  )
  return normalizePage<PlatformAuditLogItem>(res)
}
