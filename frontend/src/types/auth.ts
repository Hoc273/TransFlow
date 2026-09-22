export type User = {
  id: string
  email: string
  fullName: string
}

export type AuthResponse = {
  accessToken: string
  refreshToken: string
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
  refreshToken: string
}
