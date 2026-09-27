export type OperationUsage = {
  operation: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  operationCount: number
  /** Credits charged for this group (absent on older payloads). */
  creditUsed?: number
}

export type ModelUsage = {
  provider: string | null
  model: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  operationCount: number
}

export type UsageSummary = {
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  operationCount: number
  byOperation: OperationUsage[]
  byModel: ModelUsage[]
  /** Total credits charged in scope (absent on older payloads). */
  creditUsed?: number
  /** Always "Coming soon" at MVP (Q-DASH1). */
  cost: string
}

export type JobStatusSummary = {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  cancelled: number
}

export type BatchStatusSummary = {
  total: number
  running: number
  completed: number
  failed: number
  partiallyFailed: number
  cancelled: number
}

export type CreditSummary = {
  balance: number
  costMode: string
  chargedUserId: string | null
}

export type WorkspaceDashboardResponse = {
  jobs: JobStatusSummary
  batches: BatchStatusSummary
  credit: CreditSummary
}

