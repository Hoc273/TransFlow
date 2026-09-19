export type User = {
  id: string
  email: string
  fullName: string
  /** Platform Super Admin (docs/34) — independent of workspace RBAC. */
  isPlatformAdmin?: boolean
}

export type AuthResponse = {
  accessToken: string
  refreshToken: string
  user: User
  workspaceId?: string
  projectId?: string
}

export type LoginRequest = {
  email: string
  password: string
}

export type RegisterRequest = {
  email: string
  password: string
  fullName: string
}

export type RefreshRequest = {
  refreshToken: string
}
