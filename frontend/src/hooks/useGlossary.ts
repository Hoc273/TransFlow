import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addTermApi,
  deleteTermApi,
  getProjectGlossaryApi,
  importGlossaryCsvApi,
  listTermsApi,
  updateTermApi,
} from '@/api/glossary'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { TermBody } from '@/types/glossary'

export function useProjectGlossary(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.projectGlossary(workspaceId ?? '', projectId ?? ''),
    queryFn: () => getProjectGlossaryApi(workspaceId!, projectId!),
    enabled: Boolean(workspaceId && projectId),
    staleTime: STALE.static,
  })
}

export function useGlossaryTerms(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.glossaryTerms(workspaceId ?? '', projectId ?? ''),
    queryFn: () => listTermsApi(workspaceId!, projectId!),
    enabled: Boolean(workspaceId && projectId),
    staleTime: STALE.static,
  })
}

export function useAddTerm(workspaceId: string | undefined, projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TermBody) => addTermApi(workspaceId!, projectId!, body),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, projectId),
        })
      }
    },
  })
}

export function useUpdateTerm(workspaceId: string | undefined, projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ termId, body }: { termId: string; body: TermBody }) =>
      updateTermApi(workspaceId!, projectId!, termId, body),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, projectId),
        })
      }
    },
  })
}

export function useDeleteTerm(workspaceId: string | undefined, projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (termId: string) => deleteTermApi(workspaceId!, projectId!, termId),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, projectId),
        })
      }
    },
  })
}

export function useImportGlossaryCsv(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => importGlossaryCsvApi(workspaceId!, projectId!, file),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, projectId),
        })
      }
    },
  })
}
