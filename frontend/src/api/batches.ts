import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  BatchCreateResponse,
  BatchDetail,
  BatchSummary,
  CreateBatchParams,
  RetryResponse,
} from '@/types/batch'

export function listBatchesApi(workspaceId: string, projectId?: string) {
  const path = projectId ? `/projects/${projectId}/batches` : '/batches'
  return apiRequest<BatchSummary[]>(buildWorkspacePath(workspaceId, path))
}

export function getBatchApi(workspaceId: string, batchId: string) {
  return apiRequest<BatchDetail>(buildWorkspacePath(workspaceId, `/batches/${batchId}`))
}

export function createBatchApi(workspaceId: string, params: CreateBatchParams) {
  // If params has sourceAssetIds, use Spring Boot JSON endpoint
  if ((params as any).sourceAssetIds) {
    return apiRequest<BatchCreateResponse>(
      buildWorkspacePath(workspaceId, `/projects/${params.projectId}/batches`),
      {
        method: 'POST',
        body: {
          name: params.name?.trim(),
          sourceAssetIds: (params as any).sourceAssetIds,
          targetLang: params.targetLangs?.[0] || (params as any).targetLang,
          sharedConfig: (params as any).sharedConfig || {},
        },
      },
    )
  }

  const form = new FormData()
  form.append('projectId', params.projectId)
  form.append('sourceLang', params.sourceLang)
  for (const lang of params.targetLangs || []) {
    form.append('targetLangs', lang)
  }
  if (params.name?.trim()) {
    form.append('name', params.name.trim())
  }
  for (const file of params.files || []) {
    form.append('files', file)
  }

  // Support both Spring Boot /projects/{projectId}/batches and mock /batches
  return apiRequest<BatchCreateResponse>(
    buildWorkspacePath(workspaceId, `/projects/${params.projectId}/batches`),
    {
      method: 'POST',
      body: form,
      rawBody: true,
    },
  ).catch(() =>
    apiRequest<BatchCreateResponse>(buildWorkspacePath(workspaceId, '/batches'), {
      method: 'POST',
      body: form,
      rawBody: true,
    }),
  )
}

export function cancelBatchApi(workspaceId: string, batchId: string) {
  return apiRequest<void>(buildWorkspacePath(workspaceId, `/batches/${batchId}/cancel`), {
    method: 'POST',
  })
}

export function retryBatchJobApi(
  workspaceId: string,
  batchId: string,
  jobId: string,
) {
  return apiRequest<RetryResponse>(
    buildWorkspacePath(workspaceId, `/batches/${batchId}/jobs/${jobId}/retry`),
    { method: 'POST' },
  )
}

export function retryBatchDocumentApi(
  workspaceId: string,
  batchId: string,
  documentId: string,
) {
  return retryBatchJobApi(workspaceId, batchId, documentId).catch(() =>
    apiRequest<RetryResponse>(
      buildWorkspacePath(workspaceId, `/batches/${batchId}/documents/${documentId}/retry`),
      { method: 'POST' },
    ),
  )
}

export function downloadBulkJobsApi(workspaceId: string, projectId: string, jobIds: string[]) {
  return apiRequest<import('@/types/batch').BulkDownloadResult>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/media/jobs/download`),
    { method: 'POST', body: { jobIds } },
  )
}

/**
 * @deprecated The backend has no `GET .../batches/{batchId}/download` route
 * (BatchController documents it as not implemented). Use `downloadBulkJobsApi`.
 */
export function downloadBatchZipApi(workspaceId: string, batchId: string) {
  return apiRequest<{ downloadUrl: string; fileName: string }>(
    buildWorkspacePath(workspaceId, `/batches/${batchId}/download`),
  )
}
