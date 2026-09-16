export type OperationUsage = {
  operation: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  operationCount: number
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
  /** Always "Coming soon" at MVP (Q-DASH1). */
  cost: string
}
