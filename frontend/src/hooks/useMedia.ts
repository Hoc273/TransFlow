import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  batchEditTransformationSegmentsApi,
  cancelTransformationJobApi,
  consentTransformationAssetApi,
  confirmTransformationRenderApi,
  createTransformationCustomProposalApi,
  exportTransformationJobApi,
  getOutputPackageApi,
  getTransformationJobApi,
  getTransformationRenderConfigApi,
  getTransformationCapabilitiesApi,
  listTransformationJobsApi,
  listTransformationProposalsApi,
  continueWorkflowApi,
  resumeWorkflowApi,
  overrideTransformationSourceLangApi,
  refineTransformationNarrativePlanApi,
  rerunTransformationSummarizeApi,
  rerunTransformationTtsRenderApi,
  rerunTransformationRenderApi,
  rerunTransformationStageApi,
  selectTransformationProposalApi,
  selectTransformationVoiceApi,
  updateTransformationCustomProposalApi,
  updateTransformationRenderConfigApi,
  uploadTransformationMediaApi,
  type BatchEditMediaSegmentItem,
} from '@/api/transformation'
import { editMediaSegmentApi, getMediaTermsVersionApi, type EditMediaSegmentBody } from '@/api/media'
import { getJobApi } from '@/api/jobs'
import { hasActiveMediaStages, isActiveMediaJobStatus } from '@/lib/media'
import { STALE, queryKeys } from '@/lib/queryClient'
import type {
  CreateCustomProposalBody,
  MediaExportFormat,
  MediaJob,
  OverrideSourceLangBody,
  SelectVoiceBody,
  UpdateCustomProposalBody,
  UpdateRenderConfigBody,
} from '@/types/media'

export function useMediaJobs(
  workspaceId: string | undefined,
  projectId: string | undefined,
  options?: { poll?: boolean },
) {
  const poll = options?.poll ?? true

  return useQuery({
    queryKey: queryKeys.mediaJobs(workspaceId ?? '', projectId ?? ''),
    queryFn: () => listTransformationJobsApi(workspaceId!, projectId!),
    enabled: !!workspaceId && !!projectId,
    staleTime: STALE.semiLive,
    refetchInterval: (query) => {
      if (!poll) return false
      const data = query.state.data as MediaJob[] | undefined
      if (!data?.length) return false
      return data.some((j) => isActiveMediaJobStatus(j.status) || hasActiveMediaStages(j))
        ? 5_000
        : false
    },
  })
}

export function useMediaJob(
  workspaceId: string | undefined,
  jobId: string | undefined,
  options?: { poll?: boolean },
) {
  const poll = options?.poll ?? true

  return useQuery({
    queryKey: queryKeys.mediaJob(workspaceId ?? '', jobId ?? ''),
    queryFn: () => getTransformationJobApi(workspaceId!, jobId!),
    enabled: !!workspaceId && !!jobId,
    staleTime: STALE.semiLive,
    refetchInterval: (query) => {
      if (!poll) return false
      const job = query.state.data as MediaJob | undefined
      if (!job) return false
      return isActiveMediaJobStatus(job.status) || hasActiveMediaStages(job) ? 5_000 : false
    },
  })
}

export function useMediaProposals(workspaceId: string | undefined, jobId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.mediaProposals(workspaceId ?? '', jobId ?? ''),
    queryFn: () => listTransformationProposalsApi(workspaceId!, jobId!),
    enabled: !!workspaceId && !!jobId,
    staleTime: STALE.semiLive,
  })
}

/** Linked text translation job (segments + QA) once TRANSLATE has run. */
export function useMediaLinkedJob(
  workspaceId: string | undefined,
  translationJobId: string | null | undefined,
) {
  return useQuery({
    queryKey: queryKeys.job(workspaceId ?? '', translationJobId ?? ''),
    queryFn: () => getJobApi(workspaceId!, translationJobId!),
    enabled: !!workspaceId && !!translationJobId,
    staleTime: STALE.semiLive,
  })
}

export function useUploadMedia(workspaceId: string, projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      file,
      name,
      onProgress,
      signal,
    }: {
      file: File
      name?: string
      onProgress?: (percent: number) => void
      signal?: AbortSignal
    }) => uploadTransformationMediaApi(workspaceId, projectId, file, { name, onProgress, signal }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJobs(workspaceId, projectId) })
    },
  })
}

export function useMediaTermsVersion(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.mediaTermsVersion(workspaceId),
    queryFn: () => getMediaTermsVersionApi(workspaceId),
    staleTime: STALE.static,
    enabled: Boolean(workspaceId),
  })
}

export function useConsentMedia(workspaceId: string) {
  return useMutation({
    mutationFn: (assetId: string) => consentTransformationAssetApi(workspaceId, assetId),
  })
}

export function useEditMediaSegment(
  workspaceId: string,
  mediaJobId: string,
  translationJobId?: string | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ segmentId, body }: { segmentId: string; body: EditMediaSegmentBody }) =>
      editMediaSegmentApi(workspaceId, segmentId, body),
    onSuccess: () => {
      if (translationJobId) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, translationJobId) })
      }
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, mediaJobId) })
    },
  })
}

/**
 * Batch save of edited cues (review workbench "save all"). One PUT request,
 * all-or-nothing; invalidates the same keys as the single edit.
 */
export function useBatchEditMediaSegments(
  workspaceId: string,
  mediaJobId: string,
  translationJobId?: string | null,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: BatchEditMediaSegmentItem[]) =>
      batchEditTransformationSegmentsApi(workspaceId, mediaJobId, { updates }),
    onSuccess: () => {
      if (translationJobId) {
        void qc.invalidateQueries({ queryKey: queryKeys.job(workspaceId, translationJobId) })
      }
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, mediaJobId) })
    },
  })
}

export function useCancelMediaJob(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => cancelTransformationJobApi(workspaceId, jobId),
    onSuccess: (job) => {
      void qc.setQueryData(queryKeys.mediaJob(workspaceId, jobId), job)
      if (job.projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.mediaJobs(workspaceId, job.projectId),
        })
      }
    },
  })
}

/**
 * CT3 output package (docs/36 §5.1): presigned RENDERED_VIDEO URL + subtitle
 * track availability. Powers the Export panel's click-to-preview rows — the
 * video preview streams the presigned URL, never a forced download. 422 when
 * BLOCK_EXPORT is effective (the preview follows the same QA gate as export).
 */
export function useOutputPackage(workspaceId: string, jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.outputPackage(workspaceId, jobId),
    queryFn: () => getOutputPackageApi(workspaceId, jobId),
    enabled,
    staleTime: 60_000,
  })
}

export function useExportMediaJob(workspaceId: string, jobId: string) {
  return useMutation({
    mutationFn: (format: MediaExportFormat) => exportTransformationJobApi(workspaceId, jobId, format),
  })
}

export function useOverrideSourceLang(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OverrideSourceLangBody) =>
      overrideTransformationSourceLangApi(workspaceId, jobId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
    },
  })
}

export function useSelectVoice(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SelectVoiceBody) => selectTransformationVoiceApi(workspaceId, jobId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
    },
  })
}

export function useRenderConfig(workspaceId: string, jobId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.renderConfig(workspaceId, jobId),
    queryFn: () => getTransformationRenderConfigApi(workspaceId, jobId),
    enabled: Boolean(workspaceId && jobId && enabled),
    staleTime: STALE.semiLive,
  })
}

export function useUpdateRenderConfig(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateRenderConfigBody) =>
      updateTransformationRenderConfigApi(workspaceId, jobId, body),
    onSuccess: (config) => {
      void qc.setQueryData(queryKeys.renderConfig(workspaceId, jobId), config)
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
    },
  })
}

export function useConfirmRender(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => confirmTransformationRenderApi(workspaceId, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
      void qc.invalidateQueries({
        queryKey: [...queryKeys.mediaJob(workspaceId, jobId), 'render-config'],
      })
    },
  })
}

// ─── W0 workflow actions (docs/16 §7.5) ──────────────────────────────────────

export function useWorkflowContinue(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (checkpoint: string) => continueWorkflowApi(workspaceId, jobId, checkpoint),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
    },
  })
}

export function useWorkflowResume(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => resumeWorkflowApi(workspaceId, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
    },
  })
}

export function useCreateCustomProposal(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCustomProposalBody) =>
      createTransformationCustomProposalApi(workspaceId, jobId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaProposals(workspaceId, jobId) })
    },
  })
}

export function useUpdateCustomProposal(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      proposalId,
      body,
    }: {
      proposalId: string
      body: UpdateCustomProposalBody
    }) => updateTransformationCustomProposalApi(workspaceId, jobId, proposalId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaProposals(workspaceId, jobId) })
    },
  })
}

export function useSelectProposal(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (proposalId: string) => selectTransformationProposalApi(workspaceId, jobId, proposalId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: queryKeys.mediaProposals(workspaceId, jobId) })
    },
  })
}

export function useRefineNarrativePlan(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (feedback: string) =>
      refineTransformationNarrativePlanApi(workspaceId, jobId, feedback),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: queryKeys.mediaProposals(workspaceId, jobId) })
    },
  })
}

export function useRerunSummarize(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => rerunTransformationSummarizeApi(workspaceId, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: queryKeys.mediaProposals(workspaceId, jobId) })
    },
  })
}

export function useRerunTtsRender(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => rerunTransformationTtsRenderApi(workspaceId, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
    },
  })
}

export function useRerunRender(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: import('@/types/media').UpdateRenderConfigBody) =>
      rerunTransformationRenderApi(workspaceId, jobId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: queryKeys.renderConfig(workspaceId, jobId) })
    },
  })
}

export function useRerunStage(workspaceId: string, jobId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stageName: string) =>
      rerunTransformationStageApi(workspaceId, jobId, stageName),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJob(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: queryKeys.mediaProposals(workspaceId, jobId) })
      void qc.invalidateQueries({ queryKey: queryKeys.renderConfig(workspaceId, jobId) })
    },
  })
}

/**
 * CT10.3B availability projection. Deliberately never cached across mounts:
 * a stale snapshot could offer a mode the deployment can no longer honour.
 * Callers must also await `refetch()` immediately before creating a job.
 */
export function useTransformationCapabilities() {
  return useQuery({
    queryKey: queryKeys.transformationCapabilities,
    queryFn: getTransformationCapabilitiesApi,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  })
}
