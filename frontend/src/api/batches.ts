import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  BatchCreateResponse,
  BatchDetail,
  BatchSummary,
  CreateBatchParams,
} from '@/types/batch'
import type { MediaJob } from '@/types/media'
import { listProjectsApi } from '@/api/projects'

function enrichBatch<T extends BatchSummary>(b: T): T {
  const jobs = b.jobs || []
  const completedCount = jobs.filter((j) => String(j.status).toUpperCase() === 'COMPLETED').length
  const failedCount = jobs.filter((j) => {
    const s = String(j.status).toUpperCase()
    return s === 'FAILED' || s === 'CANCELLED'
  }).length
  const totalCount = jobs.length || (b.sourceAssetIds ? b.sourceAssetIds.length : 0)

  return {
    ...b,
    name: b.name || b.id.slice(0, 8),
    totalDocuments: b.totalDocuments ?? totalCount,
    completedDocuments: b.completedDocuments ?? completedCount,
    failedDocuments: b.failedDocuments ?? failedCount,
    documents: b.documents ?? jobs.map((j) => ({
      documentId: j.id,
      name: j.id.slice(0, 8),
      sourceLang: j.sourceLanguage || 'auto',
      status: j.status,
      jobs: [j],
    })),
  }
}

export async function listBatchesApi(workspaceId: string, projectId?: string): Promise<BatchSummary[]> {
  if (projectId) {
    const list = await apiRequest<BatchSummary[]>(
      buildWorkspacePath(workspaceId, `/projects/${projectId}/batches`),
    )
    return list.map(enrichBatch)
  }
  const projects = await listProjectsApi(workspaceId)
  const pages = await Promise.all(
    projects.map((project) =>
      apiRequest<BatchSummary[]>(
        buildWorkspacePath(workspaceId, `/projects/${project.id}/batches`),
      ),
    ),
  )
  return pages.flat().map(enrichBatch).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getBatchApi(workspaceId: string, batchId: string): Promise<BatchDetail> {
  const detail = await apiRequest<BatchDetail>(buildWorkspacePath(workspaceId, `/batches/${batchId}`))
  return enrichBatch(detail)
}

export async function createBatchApi(workspaceId: string, params: CreateBatchParams): Promise<BatchCreateResponse> {
  const res = await apiRequest<BatchCreateResponse>(
    buildWorkspacePath(workspaceId, `/projects/${params.projectId}/batches`),
    {
      method: 'POST',
      body: {
        name: params.name?.trim() || null,
        sourceAssetIds: params.sourceAssetIds || [],
        targetLang: params.targetLang || params.targetLangs?.[0] || 'en',
        sharedConfig: params.sharedConfig ?? {
          processingMode: 'TRANSLATE_ONLY',
          subtitleMode: 'SOFT_SUB',
          outputAudioMode: 'ORIGINAL_ONLY',
          sourceSeparationEnabled: false,
          workflowMode: 'MANUAL',
        },
      },
    },
  )
  const enriched = enrichBatch(res)
  return {
    ...enriched,
    batchId: enriched.id,
  }
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
  return apiRequest<MediaJob>(
    buildWorkspacePath(workspaceId, `/batches/${batchId}/jobs/${jobId}/retry`),
    { method: 'POST' },
  )
}

export const retryBatchDocumentApi = retryBatchJobApi

export function downloadBulkJobsApi(
  workspaceId: string,
  projectId: string,
  jobIds: string[],
) {
  return apiRequest<{ downloadUrl: string; fileName: string }>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/media/jobs/download`),
    { method: 'POST', body: { jobIds } },
  )
}
