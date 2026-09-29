import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getWorkspaceBillingConfigApi,
  updateWorkspaceBillingConfigApi,
  type CostMode,
} from '@/api/workspaces'
import { STALE, queryKeys } from '@/lib/queryClient'

/** GET /workspaces/{ws}/billing-config — any workspace member may read. */
export function useWorkspaceBillingConfig(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.billingConfig(workspaceId ?? ''),
    queryFn: () => getWorkspaceBillingConfigApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.static,
  })
}

/** PUT /workspaces/{ws}/billing-config — LEAD only (BE requireLead). */
export function useUpdateWorkspaceBillingConfig(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (costMode: CostMode) => updateWorkspaceBillingConfigApi(workspaceId!, { costMode }),
    onSuccess: (data) => {
      if (!workspaceId) return
      qc.setQueryData(queryKeys.billingConfig(workspaceId), data)
      // Payer changed → balance shown on the dashboard / credit widgets may differ now.
      void qc.invalidateQueries({ queryKey: queryKeys.userCredit })
    },
  })
}
