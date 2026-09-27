import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { UsageSummary, WorkspaceDashboardResponse } from '@/types/dashboard'

export type UsageQuery = {
  groupBy?: 'project' | 'user' | 'operation' | string
  from?: string
  to?: string
}

export function getUsageApi(workspaceId: string, query: UsageQuery = {}): Promise<UsageSummary> {
  const search = new URLSearchParams()
  if (query.groupBy) search.set('groupBy', query.groupBy)
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
  const qs = search.toString()
  const path = buildWorkspacePath(workspaceId, `/dashboard/usage${qs ? `?${qs}` : ''}`)

  return apiRequest<any>(path).then((res) => {
    // If backend returns UsageSummaryResponse with items: List<UsageGroupItemResponse>
    if (res && Array.isArray(res.items) && !res.byOperation) {
      const byOperation = res.items.map((item: any) => ({
        operation: item.groupLabel || item.groupKey || 'UNKNOWN',
        inputTokens: Number(item.inputTokens ?? 0),
        outputTokens: Number(item.outputTokens ?? 0),
        totalTokens: Number(item.totalTokens ?? 0),
        operationCount: Number(item.operations ?? 0),
        creditUsed: Number(item.creditUsed ?? 0),
      }))

      return {
        totalInputTokens: Number(res.totalInputTokens ?? 0),
        totalOutputTokens: Number(res.totalOutputTokens ?? 0),
        totalTokens: Number(res.totalTokens ?? 0),
        operationCount: Number(res.totalOperations ?? 0),
        byOperation,
        byModel: [],
        creditUsed: Number(res.totalCreditUsed ?? 0),
        cost: res.totalCreditUsed != null ? `${res.totalCreditUsed} credits` : 'Coming soon',
      }
    }

    return res as UsageSummary
  })
}

export function getWorkspaceDashboardApi(workspaceId: string): Promise<WorkspaceDashboardResponse> {
  return apiRequest<WorkspaceDashboardResponse>(buildWorkspacePath(workspaceId, '/dashboard'))
}

