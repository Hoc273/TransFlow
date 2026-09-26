/** Platform Super Admin types — mirror docs/34 response sketches (camelCase JSON). */

export type JobStatusCounts = {
  created: number
  completed: number
  failed: number
  processing: number
  other: number
}

export type UnavailableJobType = {
  available: false
}

export type CountInRange = {
  total: number
  newInRange: number
}

export type OperationTokens = {
  inputTokens: number
  outputTokens: number
}

export type PlatformOverview = {
  from: string
  to: string
  users: CountInRange
  workspaces: CountInRange
  jobs: {
    mediaJobs: JobStatusCounts
    batchJobs: JobStatusCounts
    textJobs: UnavailableJobType
    productionJobs: UnavailableJobType
  }
  tokens: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    byOperation: Record<string, OperationTokens>
  }
  failRate: {
    rate: number | null
    failedCount: number
    terminalCount: number
  }
  topWorkspaces: Array<{
    workspaceId: string
    workspaceName: string
    totalTokens: number
    jobCount: number
  }>
}

export type ServiceStatus = {
  id: string
  name: string
  status: 'UP' | 'DOWN' | 'DEGRADED' | string
  latencyMs: number | null
  message: string | null
}

export type PlatformServiceStatus = ServiceStatus

export type PlatformStatus = {
  checkedAt: string
  overall: 'UP' | 'DEGRADED' | 'DOWN' | string
  services: ServiceStatus[]
}

export type PlatformUserItem = {
  id: string
  email: string
  fullName: string
  status: string
  isPlatformAdmin: boolean
  createdAt: string
  workspaceCount: number
  avatarUrl?: string | null
}

export type PlatformUser = PlatformUserItem

export type PlatformWorkspaceItem = {
  id: string
  name: string
  slug: string
  ownerUserId: string
  ownerEmail: string
  memberCount: number
  createdAt: string
}

export type PlatformWorkspace = PlatformWorkspaceItem

export type PlatformAuditLogItem = {
  id: string
  actorUserId: string | null
  action: string
  httpMethod: string
  path: string
  queryString: string | null
  ip: string | null
  userAgent: string | null
  statusCode: number
  createdAt: string
  [k: string]: unknown
}

export type AuditLog = PlatformAuditLogItem

export type PlatformPage<T> = {
  content: T[]
  items?: T[]
  page: number
  size: number
  totalElements: number
  totalItems?: number
  totalPages: number
}

export type PlatformOverviewQuery = {
  from?: string
  to?: string
  topLimit?: number
}

export type PlatformUsersQuery = {
  q?: string
  page?: number
  size?: number
  isPlatformAdmin?: boolean
}

export type PlatformWorkspacesQuery = {
  q?: string
  page?: number
  size?: number
}

export type PlatformAuditQuery = {
  action?: string
  page?: number
  size?: number
}

export function isUnavailableJob(
  value: JobStatusCounts | UnavailableJobType | undefined,
): value is UnavailableJobType {
  return !!value && 'available' in value && value.available === false
}

/** SA-RT — realtime system activity snapshot polled every 3s. */
export type PlatformRealtime = {
  /** Number of MediaJobs currently in PROCESSING status right now. */
  processingJobs: number
  /** Number of MediaJobs completed since midnight UTC today. */
  completedToday: number
  /** Sum of input + output tokens consumed in the last hour. */
  tokensLastHour: number
  /** Distinct users with a presence heartbeat inside the online window. */
  onlineUsers: number
  /** ISO-8601 timestamp of when the snapshot was taken on the server. */
  checkedAt: string
}

/** SA — request body for admin credit adjustment (grant or deduct). */
export type AdminCreditAdjustRequest = {
  /** Positive = grant credit, negative = deduct credit. */
  amount: number
  /** Optional reason / note for audit trail. */
  reason?: string
}

/** SA — response from admin credit adjustment. */
export type AdminCreditAdjustResponse = {
  userId: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  reason: string | null
  adjustedAt: string
}

/** Shared platform AI key pool (GET /api/platform/providers). The API key is write-only. */
export type PlatformProviderTier = 'PAID' | 'FREE'
export type ProviderHealthStatus = 'UNKNOWN' | 'HEALTHY' | 'DOWN'

export type PlatformProvider = {
  id: string
  name: string
  protocol: string
  capabilities: string[]
  baseUrl: string
  apiKeyHint: string | null
  defaultModel: string | null
  isActive: boolean
  priority: number
  weight: number
  tier: PlatformProviderTier
  healthStatus: ProviderHealthStatus
  coolingDown: boolean
  lastCheckedAt: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string | null
}

export type PlatformProviderInput = {
  name?: string
  protocol?: string
  capabilities?: string[]
  baseUrl?: string
  apiKey?: string
  defaultModel?: string
  priority?: number
  weight?: number
  tier?: PlatformProviderTier
  isActive?: boolean
}

export type ProviderTestResult = {
  success: boolean
  message: string
  authSuccess: boolean
  capabilityResults: {
    capability: string
    success: boolean
    model: string | null
    errorCode: string | null
    message: string | null
  }[]
}

/** Credit price table x, y (Credit_Coefficient_Calculation §10). */
export type PricingCapability = 'STT' | 'TRANSLATE' | 'TTS' | 'SUMMARIZE_SCRIPT' | 'RENDER' | 'VISION'

export type PricingVersionStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED'

export interface PricingVersion {
  id: string
  capability: PricingCapability
  /** `protocol/model`, `protocol`, or null = default row. */
  providerScope: string | null
  infraCoefficientX: number
  tokenCoefficientY: number
  effectiveFrom: string
  effectiveTo: string | null
  status: PricingVersionStatus
  createdByUserId: string | null
  changeReason: string | null
  createdAt: string | null
}

export interface PricingVersionInput {
  capability: PricingCapability
  providerScope?: string | null
  infraCoefficientX: number
  tokenCoefficientY: number
  /** ISO instant; omitted = now. */
  effectiveFrom?: string
  changeReason: string
  confirmLargeChange?: boolean
}

export type PricingWarning = 'DEFAULT_Y_BELOW_SCOPED_MAX' | 'NO_DEFAULT_ROW'

export interface CreatePricingVersionResult {
  version: PricingVersion
  closedVersion: PricingVersion | null
  warnings: PricingWarning[]
}

export interface PricingRate {
  byokPerUnit: number
  platformPerUnit: number
  byokPerMinute: number
  platformPerMinute: number
}

export interface PricingJobEstimate {
  jobType: 'SUBTITLE' | 'DUB' | 'SUMMARY_VLM'
  capabilities: PricingCapability[]
  currentCreditsPerMinute: number
  proposedCreditsPerMinute: number
}

export interface PricingPreview {
  capability: PricingCapability
  providerScope: string | null
  current: PricingVersion | null
  unitsPerMinute: number
  currentRate: PricingRate
  proposedRate: PricingRate
  infraChangePercent: number | null
  tokenChangePercent: number | null
  largeChange: boolean
  jobEstimates: PricingJobEstimate[]
  warnings: PricingWarning[]
}

export type PricingMatchedBy = 'EXACT' | 'PROTOCOL' | 'DEFAULT' | 'MISSING'

export interface PricingCoverageItem {
  providerId: string
  providerName: string
  capability: PricingCapability
  pricingScope: string
  matchedBy: PricingMatchedBy
  matchedVersionId: string | null
  matchedScope: string | null
  infraCoefficientX: number | null
  tokenCoefficientY: number | null
}
