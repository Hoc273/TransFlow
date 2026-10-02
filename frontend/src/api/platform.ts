import { apiRequest } from '@/lib/api/client'
import type {
  AdminCreditAdjustRequest,
  AdminCreditAdjustResponse,
  PlatformActivityLogItem,
  PlatformActivityQuery,
  PlatformCreditMonitor,
  PlatformCreditMonitorQuery,
  PlatformCreditPurchaseItem,
  PlatformCreditPurchasesQuery,
  CreatePricingVersionResult,
  PlatformAuditLogItem,
  PlatformAuditQuery,
  PlatformOverview,
  PlatformOverviewQuery,
  PlatformPage,
  PlatformProvider,
  PlatformProviderInput,
  PlatformRealtime,
  PlatformStatus,
  PlatformUserItem,
  PlatformUsersQuery,
  PlatformWorkspaceItem,
  PlatformWorkspacesQuery,
  PricingCoverageItem,
  PricingPreview,
  PricingVersion,
  PricingVersionInput,
  ProviderTestResult,
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

/** SA — get credit balance of any user. */
export function getAdminUserCreditBalanceApi(userId: string): Promise<{ userId: string; balance: number }> {
  return apiRequest<{ userId: string; balance: number }>(`/platform/users/${userId}/credit/balance`)
}

/** SA — grant or deduct credit for any user (amount positive = grant, negative = deduct). */
export function adminAdjustUserCreditApi(
  userId: string,
  req: AdminCreditAdjustRequest,
): Promise<AdminCreditAdjustResponse> {
  return apiRequest<AdminCreditAdjustResponse>(`/platform/users/${userId}/credit/adjust`, {
    method: 'POST',
    body: req,
  })
}

/** SA — regular-user activity log. */
export async function getPlatformActivityLogsApi(
  query: PlatformActivityQuery = {},
): Promise<PlatformPage<PlatformActivityLogItem>> {
  const res = await apiRequest<unknown>(
    `/platform/activity-logs${qs({
      userId: query.userId,
      workspaceId: query.workspaceId,
      q: query.q,
      failedOnly: query.failedOnly,
      page: query.page,
      size: query.size,
    })}`,
  )
  return normalizePage<PlatformActivityLogItem>(res)
}

/** SA — credit monitor: balances, 7-day flow and anomaly flags. */
export async function getPlatformCreditMonitorApi(
  query: PlatformCreditMonitorQuery = {},
): Promise<PlatformCreditMonitor> {
  const res = await apiRequest<PlatformCreditMonitor & { accounts: unknown }>(
    `/platform/credit/accounts${qs({
      q: query.q,
      flaggedOnly: query.flaggedOnly,
      sort: query.sort,
      page: query.page,
      size: query.size,
    })}`,
  )
  return { ...res, accounts: normalizePage(res.accounts) }
}

/** SA — credit package purchases; credit is granted only on approve. */
export async function getPlatformCreditPurchasesApi(
  query: PlatformCreditPurchasesQuery = {},
): Promise<PlatformPage<PlatformCreditPurchaseItem>> {
  const res = await apiRequest<unknown>(
    `/platform/credit/purchases${qs({
      status: query.status,
      page: query.page,
      size: query.size,
    })}`,
  )
  return normalizePage<PlatformCreditPurchaseItem>(res)
}

export function reviewPlatformCreditPurchaseApi(
  purchaseId: string,
  decision: 'approve' | 'reject',
  note?: string,
): Promise<PlatformCreditPurchaseItem> {
  return apiRequest<PlatformCreditPurchaseItem>(`/platform/credit/purchases/${purchaseId}/${decision}`, {
    method: 'POST',
    body: { note },
  })
}

/** SA — shared platform AI key pool. */
export function getPlatformProvidersApi() {
  return apiRequest<PlatformProvider[]>('/platform/providers')
}

export function createPlatformProviderApi(body: PlatformProviderInput) {
  return apiRequest<PlatformProvider>('/platform/providers', { method: 'POST', body })
}

export function updatePlatformProviderApi(id: string, body: PlatformProviderInput) {
  return apiRequest<PlatformProvider>(`/platform/providers/${id}`, { method: 'PATCH', body })
}

export function deletePlatformProviderApi(id: string) {
  return apiRequest<void>(`/platform/providers/${id}`, { method: 'DELETE' })
}

export function testPlatformProviderApi(id: string) {
  return apiRequest<ProviderTestResult>(`/platform/providers/${id}/test`, { method: 'POST' })
}

export function syncPlatformProviderVoicesApi(id: string) {
  return apiRequest<{ activeVoices: number }>(`/platform/providers/${id}/voices/sync`, { method: 'POST' })
}

/** SA — credit price table (versioned; no update/delete). */
export function getPlatformPricingApi() {
  return apiRequest<PricingVersion[]>('/platform/pricing')
}

export function getPlatformPricingHistoryApi(query: { capability?: string; providerScope?: string } = {}) {
  return apiRequest<PricingVersion[]>(
    `/platform/pricing/history${qs({ capability: query.capability, providerScope: query.providerScope })}`,
  )
}

export function createPlatformPricingApi(body: PricingVersionInput) {
  return apiRequest<CreatePricingVersionResult>('/platform/pricing', { method: 'POST', body })
}

export function previewPlatformPricingApi(
  body: Pick<PricingVersionInput, 'capability' | 'providerScope' | 'infraCoefficientX' | 'tokenCoefficientY'>,
) {
  return apiRequest<PricingPreview>('/platform/pricing/preview', { method: 'POST', body })
}

export function getPlatformPricingCoverageApi() {
  return apiRequest<PricingCoverageItem[]>('/platform/pricing/coverage')
}
