import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/api/creative'
import { hasActiveCreativeStages, isActiveCreativeJobStatus } from '@/lib/creative'
import { STALE } from '@/lib/queryClient'

export const creativeKeys = {
  jobs: (ws: string, projectId?: string) => ['creativeJobs', ws, projectId ?? ''] as const,
  job: (ws: string, jobId: string) => ['creativeJob', ws, jobId] as const,
  artifacts: (ws: string, jobId: string) => ['creativeArtifacts', ws, jobId] as const,
  clips: (ws: string, jobId: string) => ['creativeArtifacts', ws, jobId, 'clips'] as const,
}

function shouldPollJob(job: api.CreativeJob | undefined): boolean {
  if (!job) return false
  return isActiveCreativeJobStatus(job.status) || hasActiveCreativeStages(job)
}

export function useCreativeJobs(workspaceId?: string, projectId?: string) {
  return useQuery({
    queryKey: creativeKeys.jobs(workspaceId ?? '', projectId),
    queryFn: () => api.listCreativeJobsApi(workspaceId!, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: STALE.semiLive,
    refetchInterval: (q) => {
      const data = q.state.data as api.CreativeJob[] | undefined
      if (!data?.length) return false
      return data.some((j) => isActiveCreativeJobStatus(j.status) || hasActiveCreativeStages(j)) ? 5000 : false
    },
  })
}

export function useCreativeJob(workspaceId?: string, jobId?: string) {
  return useQuery({
    queryKey: creativeKeys.job(workspaceId ?? '', jobId ?? ''),
    queryFn: () => api.getCreativeJobApi(workspaceId!, jobId!),
    enabled: !!workspaceId && !!jobId,
    staleTime: STALE.semiLive,
    refetchInterval: (q) => {
      const job = q.state.data as api.CreativeJob | undefined
      return shouldPollJob(job) ? 5000 : false
    },
  })
}

export function useCreativeArtifacts(workspaceId?: string, jobId?: string) {
  const jobQuery = useCreativeJob(workspaceId, jobId)
  const query = useQuery({
    queryKey: creativeKeys.artifacts(workspaceId ?? '', jobId ?? ''),
    queryFn: () => api.listCreativeArtifactsApi(workspaceId!, jobId!),
    enabled: !!workspaceId && !!jobId,
    staleTime: STALE.semiLive,
    refetchInterval: shouldPollJob(jobQuery.data) ? 5000 : false,
  })
  return query
}

export function useCreativeClips(workspaceId?: string, jobId?: string) {
  const jobQuery = useCreativeJob(workspaceId, jobId)
  return useQuery({
    queryKey: creativeKeys.clips(workspaceId ?? '', jobId ?? ''),
    queryFn: () => api.listCreativeClipsApi(workspaceId!, jobId!),
    enabled: !!workspaceId && !!jobId,
    staleTime: STALE.semiLive,
    refetchInterval: shouldPollJob(jobQuery.data) ? 5000 : false,
  })
}

export function useCreateCreativeJob(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ body, key }: { body: api.CreateCreativeJobBody; key: string }) =>
      api.createCreativeJobApi(workspaceId, body, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creativeJobs', workspaceId] })
    },
  })
}

export function useCancelCreativeJob(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.cancelCreativeJobApi(workspaceId, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: ['creativeJobs', workspaceId] })
    },
  })
}

export function useRetryCreativeStage(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stageId: string) => api.retryCreativeStageApi(workspaceId, jobId, stageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: ['creativeJobs', workspaceId] })
    },
  })
}

export function useComposeCreative(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ script, key }: { script: api.ScriptRequest; key: string }) =>
      api.composeCreativeJobApi(workspaceId, jobId, script, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: creativeKeys.artifacts(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: creativeKeys.clips(workspaceId, jobId) })
    },
  })
}

export function useIngestCreativeVideo(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, key, onProgress }: { file: File; key: string; onProgress?: (p: number) => void }) =>
      api.ingestCreativeVideoApi(workspaceId, jobId, file, key, onProgress),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
    },
  })
}

export function useRunClipFactory(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ clipCount, key }: { clipCount: number; key: string }) =>
      api.runClipFactoryApi(workspaceId, jobId, clipCount, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: creativeKeys.artifacts(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: creativeKeys.clips(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: ['creativeJobs', workspaceId] })
    },
  })
}

export function useRunAnimatedExplainer(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ brief, key }: { brief: api.AnimatedExplainerBrief; key: string }) =>
      api.runAnimatedExplainerE2EApi(workspaceId, jobId, brief, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: creativeKeys.artifacts(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: ['creativeJobs', workspaceId] })
    },
  })
}

export function useResearchAnimatedExplainer(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ brief, key }: { brief: api.AnimatedExplainerBrief; key: string }) =>
      api.researchAnimatedExplainerApi(workspaceId, jobId, brief, key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: creativeKeys.job(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: creativeKeys.artifacts(workspaceId, jobId) })
    },
  })
}

/**
 * Presigned read URL for one job-scoped object ref. URLs live 15 minutes
 * server-side — cache slightly below that and never refetch on window focus.
 */
export function useCreativeStorageUrl(workspaceId: string, jobId: string, objectKey: string | null) {
  return useQuery({
    queryKey: ['creativeStorageUrl', workspaceId, jobId, objectKey],
    queryFn: () => api.creativeStorageUrlApi(workspaceId, jobId, objectKey!),
    enabled: !!workspaceId && !!jobId && !!objectKey,
    staleTime: 8 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
