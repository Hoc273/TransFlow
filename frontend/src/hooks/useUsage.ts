import { useQuery } from '@tanstack/react-query'
import { getUsageApi, type UsageQuery } from '@/api/dashboard'
import { STALE, queryKeys } from '@/lib/queryClient'
import { usePermission } from '@/hooks/usePermission'

export function useUsage(workspaceId: string | undefined, query: UsageQuery = {}) {
  const canView = usePermission('dashboard.usage')

  return useQuery({
    queryKey: queryKeys.usage(workspaceId ?? '', query),
    queryFn: () => getUsageApi(workspaceId!, query),
    enabled: !!workspaceId && canView,
    staleTime: STALE.realtime,
  })
}

/** Extract EMBED tokens from byOperation breakdown. */
export function embedTokensFromUsage(
  byOperation: { operation: string; inputTokens: number; outputTokens: number }[] | undefined,
): number {
  if (!byOperation?.length) return 0
  return byOperation
    .filter((row) => row.operation.toUpperCase() === 'EMBED')
    .reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0)
}
