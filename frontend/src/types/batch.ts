import type { JobStatus } from '@/components/shared/StatusBadge'
import type { MediaJob } from '@/types/media'

export type BatchJob = MediaJob

export type BatchDocument = {
  documentId: string
  name: string
  sourceLang: string
  origin?: string
  status: JobStatus | string
  jobs: BatchJob[]
}

export type BatchSummary = {
  id: string
  workspaceId: string
  projectId: string
  name: string | null
  sourceAssetIds: string[]
  targetLang: string
  sharedConfig: Record<string, unknown>
  status: JobStatus | string
  createdBy: string
  createdAt: string
  jobs?: MediaJob[]
  totalDocuments?: number
  completedDocuments?: number
  failedDocuments?: number
  documents?: BatchDocument[]
}

export type BatchDetail = BatchSummary & {
  jobs?: MediaJob[]
  documents?: BatchDocument[]
}

export type BatchCreateResponse = BatchDetail & {
  batchId?: string
}

export type CreateBatchParams = {
  projectId: string
  sourceAssetIds?: string[]
  targetLang?: string
  name?: string
  sourceLang?: string
  targetLangs?: string[]
  files?: File[]
  sharedConfig?: {
    processingMode?: 'TRANSLATE_ONLY' | 'HYBRID'
    subtitleMode?: 'HARD_SUB' | 'SOFT_SUB'
    outputAudioMode?: 'ORIGINAL_ONLY' | 'DUB_REPLACE' | 'DUB_MIX'
    sourceSeparationEnabled?: boolean
    ttsProviderId?: string | null
    ttsVoiceId?: string | null
    workflowMode?: 'MANUAL' | 'AUTO'
    presetId?: string | null
  }
}
