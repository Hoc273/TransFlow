export type User = {
  id: string
  email: string
  fullName: string
  /** Whether account is linked to Google OAuth (07 Q-AUTH-G*). */
  googleLinked?: boolean
  /** Platform Super Admin (docs/34) — independent of workspace RBAC. */
  isPlatformAdmin?: boolean
  avatarUrl?: string | null
}

/** The refresh token is not in the body — it is set as an HttpOnly cookie. */
export type AuthResponse = {
  accessToken: string
  user: User
}

export type LoginRequest = {
  email: string
  password: string
}

export type RegisterRequest = {
  email: string
  password: string
  fullName: string
  otp?: string
}

export type RefreshRequest = {
  refreshToken?: string
}
