import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import {
  uploadTransformationMediaApi,
  consentTransformationAssetApi,
} from '@/api/transformation'
import type {
  BatchCreateResponse,
  BatchDetail,
  BatchSummary,
  CreateBatchParams,
  RetryResponse,
} from '@/types/batch'

function normalizeBatch(b: any): BatchSummary {
  return {
    id: String(b.id || ''),
    projectId: String(b.projectId || ''),
    name: b.name || `Batch ${b.id?.toString().slice(0, 8) || ''}`,
    status: b.status || 'PENDING',
    totalDocuments: b.totalDocuments ?? b.sourceAssetIds?.length ?? b.jobs?.length ?? 0,
    completedDocuments:
      b.completedDocuments ??
      b.jobs?.filter?.((j: any) => j.status === 'COMPLETED')?.length ??
      0,
    failedDocuments:
      b.failedDocuments ??
      b.jobs?.filter?.((j: any) => j.status === 'FAILED')?.length ??
      0,
    totalSizeBytes: b.totalSizeBytes ?? 0,
    createdAt: b.createdAt || new Date().toISOString(),
    updatedAt: b.updatedAt || b.createdAt || new Date().toISOString(),
  }
}

export async function listBatchesApi(
  workspaceId: string,
  projectId?: string,
): Promise<BatchSummary[]> {
  try {
    if (projectId) {
      const batches = await apiRequest<any[]>(
        buildWorkspacePath(workspaceId, `/projects/${projectId}/batches`),
      )
      return (batches || []).map(normalizeBatch)
    }

    // Try fetching across workspace projects
    try {
      const projects = await apiRequest<any[]>(buildWorkspacePath(workspaceId, '/projects'))
      if (projects && projects.length > 0) {
        const batchLists = await Promise.all(
          projects.map((p) =>
            apiRequest<any[]>(
              buildWorkspacePath(workspaceId, `/projects/${p.id}/batches`),
            ).catch(() => []),
          ),
        )
        return batchLists.flat().map(normalizeBatch)
      }
    } catch {
      // Fallback
    }

    const batches = await apiRequest<any[]>(buildWorkspacePath(workspaceId, '/batches'))
    return (batches || []).map(normalizeBatch)
  } catch {
    return []
  }
}

export async function getBatchApi(
  workspaceId: string,
  batchId: string,
): Promise<BatchDetail> {
  const b = await apiRequest<any>(buildWorkspacePath(workspaceId, `/batches/${batchId}`))
  const base = normalizeBatch(b)
  const documents = (b.jobs || []).map((j: any) => ({
    documentId: String(j.rootAssetId || j.id),
    name: j.name || `Job ${j.id?.toString().slice(0, 8) || ''}`,
    sourceLang: j.sourceLanguage || 'auto',
    origin: 'UPLOAD',
    status: j.status || 'PENDING',
    jobs: [
      {
        jobId: String(j.id),
        targetLang: j.targetLang || b.targetLang || 'vi',
        status: j.status || 'PENDING',
      },
    ],
  }))
  return {
    ...base,
    documents,
  }
}

export async function createBatchApi(
  workspaceId: string,
  params:
    | CreateBatchParams
    | {
        projectId: string
        name?: string
        sourceAssetIds?: string[]
        targetLangs: string[]
        sharedConfig?: any
        files?: File[]
      },
): Promise<BatchCreateResponse> {
  let assetIds: string[] = (params as any).sourceAssetIds ?? []

  // If files are provided and no asset IDs, upload media assets first
  if (params.files && params.files.length > 0 && assetIds.length === 0) {
    const uploads = await Promise.all(
      params.files.map(async (file) => {
        const up = await uploadTransformationMediaApi(workspaceId, params.projectId, file)
        await consentTransformationAssetApi(workspaceId, up.assetId)
        return up.assetId
      }),
    )
    assetIds = uploads
  }

  const targetLang = params.targetLangs?.[0] || 'vi'
  const payload = {
    name: params.name?.trim() || `Batch ${new Date().toISOString().slice(0, 10)}`,
    sourceAssetIds: assetIds,
    targetLang,
    sharedConfig: (params as any).sharedConfig || {
      processingMode: 'HYBRID',
      subtitleMode: 'SOFT_SUB',
      outputAudioMode: 'DUB_MIX',
      sourceSeparationEnabled: true,
      workflowMode: 'AUTO',
    },
  }

  const res = await apiRequest<any>(
    buildWorkspacePath(workspaceId, `/projects/${params.projectId}/batches`),
    {
      method: 'POST',
      body: payload,
    },
  )

  return {
    batchId: String(res.id || ''),
    documents: (res.jobs || []).map((j: any) => ({
      documentId: String(j.rootAssetId || j.id),
      fileName: j.name || 'asset',
      jobIds: [String(j.id)],
    })),
  }
}

export function cancelBatchApi(workspaceId: string, batchId: string) {
  return apiRequest<any>(buildWorkspacePath(workspaceId, `/batches/${batchId}/cancel`), {
    method: 'POST',
  })
}

export function retryBatchJobApi(
  workspaceId: string,
  batchId: string,
  jobId: string,
) {
  return apiRequest<any>(
    buildWorkspacePath(workspaceId, `/batches/${batchId}/jobs/${jobId}/retry`),
    { method: 'POST' },
  )
}

export function retryBatchDocumentApi(
  workspaceId: string,
  batchId: string,
  documentId: string,
): Promise<RetryResponse> {
  return retryBatchJobApi(workspaceId, batchId, documentId).then((job) => ({
    batchId,
    documentId,
    retriedJobIds: [String(job.id)],
    message: 'Job retry initiated',
  }))
}
