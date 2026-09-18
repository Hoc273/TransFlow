import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createJobApi, getJobApi, listJobsApi } from '@/api/jobs'
import {
  approveSegmentApi,
  overrideQaIssueApi,
  resolveQaIssueApi,
  segmentHistoryApi,
  updateSegmentApi,
} from '@/api/segments'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { CreateJobBody, UpdateSegmentBody } from '@/types/job'
import type { OverrideQaIssueBody, ResolveIssueBody } from '@/types/qa'

export function useJobs(workspaceId: string | undefined, documentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.jobs(workspaceId ?? '', documentId ?? ''),
    queryFn: () => listJobsApi(workspaceId!, documentId!),
    enabled: !!workspaceId && !!documentId,
    staleTime: STALE.realtime,
  })
}

export function useJob(workspaceId: string | undefined, jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.job(workspaceId ?? '', jobId ?? ''),
    queryFn: () => getJobApi(workspaceId!, jobId!),
    enabled: !!workspaceId && !!jobId,
    staleTime: STALE.realtime,
  })
}

export function useCreateJob(
  workspaceId: string | undefined,
  documentId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateJobBody) => createJobApi(workspaceId!, documentId!, body),
    onSuccess: (job) => {
      if (workspaceId && documentId) {
        void qc.invalidateQueries({ queryKey: queryKeys.jobs(workspaceId, documentId) })
      }
      if (workspaceId && job?.id) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, job.id) })
      }
    },
  })
}

export function useUpdateSegment(workspaceId: string | undefined, jobId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ segmentId, body }: { segmentId: string; body: UpdateSegmentBody }) =>
      updateSegmentApi(workspaceId!, segmentId, body),
    onSuccess: () => {
      if (workspaceId && jobId) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, jobId) })
      }
    },
  })
}

export function useApproveSegment(workspaceId: string | undefined, jobId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (segmentId: string) => approveSegmentApi(workspaceId!, segmentId),
    onSuccess: () => {
      if (workspaceId && jobId) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, jobId) })
      }
    },
  })
}

export function useResolveQaIssue(workspaceId: string | undefined, jobId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      issueId,
      body,
    }: {
      issueId: string
      body?: ResolveIssueBody
    }) => resolveQaIssueApi(workspaceId!, issueId, body),
    onSuccess: () => {
      if (workspaceId && jobId) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, jobId) })
      }
    },
  })
}

export function useOverrideQaIssue(workspaceId: string | undefined, jobId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      issueId,
      body,
    }: {
      issueId: string
      body: OverrideQaIssueBody
    }) => overrideQaIssueApi(workspaceId!, issueId, body),
    onSuccess: () => {
      if (workspaceId && jobId) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, jobId) })
      }
    },
  })
}

export function useSegmentHistory(
  workspaceId: string | undefined,
  segmentId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.segmentHistory(workspaceId ?? '', segmentId ?? ''),
    queryFn: () => segmentHistoryApi(workspaceId!, segmentId!),
    enabled: !!workspaceId && !!segmentId,
    staleTime: STALE.static,
  })
}
