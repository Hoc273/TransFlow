import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addTermsApi,
  createGlossaryApi,
  deleteGlossaryApi,
  deleteTermApi,
  importGlossaryCsvApi,
  listGlossariesApi,
  listTermsApi,
  updateGlossaryApi,
  updateTermApi,
} from '@/api/glossary'
import { STALE, queryKeys } from '@/lib/queryClient'
import type {
  CreateGlossaryBody,
  TermBody,
  UpdateGlossaryBody,
} from '@/types/glossary'

export function useGlossaries(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.glossaries(workspaceId ?? ''),
    queryFn: () => listGlossariesApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.static,
  })
}

export function useGlossaryTerms(
  workspaceId: string | undefined,
  glossaryId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.glossaryTerms(workspaceId ?? '', glossaryId ?? ''),
    queryFn: () => listTermsApi(workspaceId!, glossaryId!),
    enabled: !!workspaceId && !!glossaryId,
    staleTime: STALE.static,
  })
}

export function useCreateGlossary(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateGlossaryBody) => createGlossaryApi(workspaceId!, body),
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({ queryKey: queryKeys.glossaries(workspaceId) })
      }
    },
  })
}

export function useUpdateGlossary(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ glossaryId, body }: { glossaryId: string; body: UpdateGlossaryBody }) =>
      updateGlossaryApi(workspaceId!, glossaryId, body),
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({ queryKey: queryKeys.glossaries(workspaceId) })
      }
    },
  })
}

export function useDeleteGlossary(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (glossaryId: string) => deleteGlossaryApi(workspaceId!, glossaryId),
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({ queryKey: queryKeys.glossaries(workspaceId) })
      }
    },
  })
}

export function useAddTerms(workspaceId: string | undefined, glossaryId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (terms: TermBody[]) => addTermsApi(workspaceId!, glossaryId!, terms),
    onSuccess: () => {
      if (workspaceId && glossaryId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, glossaryId),
        })
        void qc.invalidateQueries({ queryKey: queryKeys.glossaries(workspaceId) })
      }
    },
  })
}

export function useUpdateTerm(workspaceId: string | undefined, glossaryId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ termId, body }: { termId: string; body: TermBody }) =>
      updateTermApi(workspaceId!, glossaryId!, termId, body),
    onSuccess: () => {
      if (workspaceId && glossaryId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, glossaryId),
        })
      }
    },
  })
}

export function useDeleteTerm(workspaceId: string | undefined, glossaryId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (termId: string) => deleteTermApi(workspaceId!, glossaryId!, termId),
    onSuccess: () => {
      if (workspaceId && glossaryId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, glossaryId),
        })
        void qc.invalidateQueries({ queryKey: queryKeys.glossaries(workspaceId) })
      }
    },
  })
}

export function useImportGlossaryCsv(
  workspaceId: string | undefined,
  glossaryId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => importGlossaryCsvApi(workspaceId!, glossaryId!, file),
    onSuccess: () => {
      if (workspaceId && glossaryId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.glossaryTerms(workspaceId, glossaryId),
        })
        void qc.invalidateQueries({ queryKey: queryKeys.glossaries(workspaceId) })
      }
    },
  })
}
