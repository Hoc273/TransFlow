/** Persisted QA issue as returned on segments / resolve flows (BE QaIssue entity). */
export type QaSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string

export type BlockingAction =
  | 'BLOCK_TM_WRITEBACK'
  | 'BLOCK_APPROVAL'
  | 'BLOCK_EXPORT'
  | 'BLOCK_RENDER'
  | string

export type QaIssue = {
  id: string
  type: string
  severity: QaSeverity
  message: string
  sourceSpan: string | null
  targetSpan: string | null
  suggestion: string | null
  resolved: boolean
  /** Optional — present when 06b fields ship on BE. */
  blockingActions?: BlockingAction[]
  overrides?: Array<{
    blockingAction: BlockingAction
    overriddenBy?: string
    reason?: string
    overriddenAt?: string
  }>
  subtitleSegmentId?: string
  issueType?: string
  resolvedAt?: string | null
  createdAt?: string
}

export type ResolveIssueBody = {
  applySuggestion?: boolean
}

export type OverrideQaIssueBody = {
  blockingAction: BlockingAction
  reason: string
}
