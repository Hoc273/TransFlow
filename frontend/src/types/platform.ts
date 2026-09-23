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
  /** ISO-8601 timestamp of when the snapshot was taken on the server. */
  checkedAt: string
}
