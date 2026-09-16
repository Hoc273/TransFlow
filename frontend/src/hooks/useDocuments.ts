import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createDocumentApi,
  listDocumentsApi,
  uploadDocumentApi,
} from '@/api/documents'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { CreateDocumentBody, UploadDocumentParams } from '@/types/document'

export function useDocuments(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.documents(workspaceId ?? '', projectId ?? ''),
    queryFn: () => listDocumentsApi(workspaceId!, projectId!),
    enabled: !!workspaceId && !!projectId,
    staleTime: STALE.static,
  })
}

export function useCreateDocument(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateDocumentBody) =>
      createDocumentApi(workspaceId!, projectId!, body),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.documents(workspaceId, projectId),
        })
      }
    },
  })
}

export function useUploadDocument(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (params: UploadDocumentParams) =>
      uploadDocumentApi(workspaceId!, projectId!, params),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.documents(workspaceId, projectId),
        })
      }
    },
  })
}
