import type { JobStatus } from '@/components/shared/StatusBadge'

export type BatchSummary = {
  id: string
  projectId: string
  name: string
  status: JobStatus | string
  totalDocuments: number
  completedDocuments: number
  failedDocuments: number
  totalSizeBytes: number
  createdAt: string
  updatedAt: string
}

export type BatchJob = {
  jobId: string
  targetLang: string
  status: JobStatus | string
}

export type BatchDocument = {
  documentId: string
  name: string
  sourceLang: string
  origin: string
  status: JobStatus | string
  jobs: BatchJob[]
}

export type BatchDetail = BatchSummary & {
  documents: BatchDocument[]
}

export type BatchCreateResponse = {
  batchId: string
  documents: Array<{
    documentId: string
    fileName: string
    jobIds: string[]
  }>
}

export type RetryResponse = {
  batchId: string
  documentId: string
  retriedJobIds: string[]
  message: string
}

export type CreateBatchParams = {
  projectId: string
  sourceLang: string
  targetLangs: string[]
  name?: string
  files: File[]
}

export type BulkDownloadResult = {
  downloadUrl: string
  fileName: string
  expiresAt: string
  includedJobIds: string[]
  skipped: Array<{ jobId: string; reason: string }>
}
