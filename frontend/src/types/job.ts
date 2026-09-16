import type { QaIssue } from '@/types/qa'

export type SegmentStatus = 'NEW' | 'TRANSLATED' | 'QA_FLAGGED' | 'APPROVED' | string

export type JobSummary = {
  id: string
  documentId: string
  targetLang: string
  status: string
  providerUsed: string | null
  modelUsed: string | null
  createdAt: string
}

export type SegmentItem = {
  id: string
  seq: number
  sourceText: string
  targetText: string | null
  status: SegmentStatus
  tmScore: number | null
  qaIssues: QaIssue[]
  /** Original video timeline (media segments); null for text jobs. */
  startMs?: number | null
  endMs?: number | null
}

export type JobDetail = {
  id: string
  documentId: string
  targetLang: string
  status: string
  providerUsed: string | null
  modelUsed: string | null
  segments: SegmentItem[]
}

export type CreateJobBody = {
  targetLang: string
}

export type JobStreamEvent = {
  jobId: string
  segmentId: string | null
  seq: number | null
  stage: string
  delta: string | null
  status: string | null
  detail: JobDetail | null
}

export type UpdateSegmentBody = {
  targetText: string
}
