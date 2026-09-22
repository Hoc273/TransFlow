import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { CreateDocumentBody, DocumentItem, UploadDocumentParams } from '@/types/document'

export function listDocumentsApi(workspaceId: string, projectId: string) {
  return apiRequest<DocumentItem[]>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/documents`),
  )
}

export function getDocumentApi(workspaceId: string, documentId: string) {
  return apiRequest<DocumentItem>(
    buildWorkspacePath(workspaceId, `/documents/${documentId}`),
  )
}

export function createDocumentApi(
  workspaceId: string,
  projectId: string,
  body: CreateDocumentBody,
) {
  return apiRequest<DocumentItem>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/documents`),
    { method: 'POST', body },
  )
}

export function uploadDocumentApi(
  workspaceId: string,
  projectId: string,
  params: UploadDocumentParams,
) {
  const form = new FormData()
  form.append('file', params.file)
  if (params.name?.trim()) form.append('name', params.name.trim())
  if (params.sourceLang?.trim()) form.append('sourceLang', params.sourceLang.trim())

  return apiRequest<DocumentItem>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/documents/upload`),
    { method: 'POST', body: form, rawBody: true },
  )
}
