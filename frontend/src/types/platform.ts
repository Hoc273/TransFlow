export type PlatformOverview = {
  from: string
  to: string
  users: { total: number; newInRange: number }
  workspaces: { total: number; newInRange: number }
  jobs: Record<string, { created: number; completed: number; failed: number; processing: number; other: number }>
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number; byOperation: Record<string, number> }
  failRate: { rate: number; failedCount: number; terminalCount: number }
  topWorkspaces: Array<{ workspaceId: string; workspaceName: string; totalTokens: number; jobCount: number }>
}

export type PlatformServiceStatus = {
  id: string
  name: string
  status: 'UP' | 'DOWN'
  latencyMs: number
  message: string
}

export type PlatformStatus = {
  checkedAt: string
  overall: string
  services: PlatformServiceStatus[]
}

export type PlatformUser = {
  id: string
  email: string
  fullName: string
  status: string
  isPlatformAdmin: boolean
  createdAt: string
  workspaceCount: number
}

export type PlatformWorkspace = {
  id: string
  name: string
  slug: string
  ownerUserId: string
  ownerEmail: string
  memberCount: number
  createdAt: string
}

export type AuditLog = {
  id?: string
  action?: string
  createdAt?: string
  [k: string]: unknown
}

export type PlatformPage<T> = {
  items: T[]
  page: number
  size: number
  totalItems: number
  totalPages: number
}
