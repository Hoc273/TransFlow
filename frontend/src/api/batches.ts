import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  BatchCreateResponse,
  BatchDetail,
  BatchSummary,
  CreateBatchParams,
  RetryResponse,
} from '@/types/batch'

export function listBatchesApi(workspaceId: string) {
  return apiRequest<BatchSummary[]>(buildWorkspacePath(workspaceId, '/batches'))
}

export function getBatchApi(workspaceId: string, batchId: string) {
  return apiRequest<BatchDetail>(buildWorkspacePath(workspaceId, `/batches/${batchId}`))
}

export function createBatchApi(workspaceId: string, params: CreateBatchParams) {
  const form = new FormData()
  form.append('projectId', params.projectId)
  form.append('sourceLang', params.sourceLang)
  for (const lang of params.targetLangs) {
    form.append('targetLangs', lang)
  }
  if (params.name?.trim()) {
    form.append('name', params.name.trim())
  }
  for (const file of params.files) {
    form.append('files', file)
  }

  return apiRequest<BatchCreateResponse>(buildWorkspacePath(workspaceId, '/batches'), {
    method: 'POST',
    body: form,
    rawBody: true,
  })
}

export function retryBatchDocumentApi(
  workspaceId: string,
  batchId: string,
  documentId: string,
) {
  return apiRequest<RetryResponse>(
    buildWorkspacePath(workspaceId, `/batches/${batchId}/documents/${documentId}/retry`),
    { method: 'POST' },
  )
}
