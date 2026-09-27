import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBatchApi,
  downloadBulkJobsApi,
  getBatchApi,
  listBatchesApi,
  retryBatchJobApi,
} from '@/api/batches'
import { isActiveBatchStatus } from '@/lib/status'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { BatchSummary, CreateBatchParams } from '@/types/batch'

export function isBatchActive(batch: BatchSummary): boolean {
  return isActiveBatchStatus(String(batch.status))
}

export function useBatches(workspaceId: string | undefined, options?: { pollActive?: boolean }) {
  const pollActive = options?.pollActive ?? true

  return useQuery({
    queryKey: queryKeys.batches(workspaceId ?? ''),
    queryFn: () => listBatchesApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.semiLive,
    refetchInterval: (query) => {
      if (!pollActive) return false
      const data = query.state.data
      if (!data?.length) return false
      const hasActive = data.some(isBatchActive)
      return hasActive ? 5_000 : false
    },
  })
}

export function useActiveBatches(workspaceId: string | undefined) {
  const query = useBatches(workspaceId, { pollActive: true })
  const active = (query.data ?? []).filter(isBatchActive)
  return { ...query, active }
}

export function useBatchDetail(
  workspaceId: string | undefined,
  batchId: string | undefined,
  options?: { poll?: boolean },
) {
  const poll = options?.poll ?? true

  return useQuery({
    queryKey: queryKeys.batchDetail(workspaceId ?? '', batchId ?? ''),
    queryFn: () => getBatchApi(workspaceId!, batchId!),
    enabled: !!workspaceId && !!batchId,
    staleTime: STALE.semiLive,
    refetchInterval: (query) => {
      if (!poll) return false
      const data = query.state.data
      if (!data) return false
      return isActiveBatchStatus(String(data.status)) ? 5_000 : false
    },
  })
}

export function useCreateBatch(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: CreateBatchParams) => createBatchApi(workspaceId!, params),
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({ queryKey: queryKeys.batches(workspaceId) })
        void qc.invalidateQueries({ queryKey: queryKeys.projects(workspaceId) })
      }
    },
  })
}

export function useRetryBatchJob(workspaceId: string | undefined, batchId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => retryBatchJobApi(workspaceId!, batchId!, jobId),
    onSuccess: () => {
      if (workspaceId && batchId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.batchDetail(workspaceId, batchId),
        })
        void qc.invalidateQueries({ queryKey: queryKeys.batches(workspaceId) })
      }
    },
  })
}

export const useRetryBatchDocument = useRetryBatchJob

export function useDownloadBulkJobs(workspaceId: string | undefined, projectId: string | undefined) {
  return useMutation({
    mutationFn: (jobIds: string[]) => downloadBulkJobsApi(workspaceId!, projectId!, jobIds),
  })
}
