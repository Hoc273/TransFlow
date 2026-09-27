import { apiRequest } from '@/lib/api/client'
import type { AuthResponse, LoginRequest, RegisterRequest, User } from '@/types/auth'

const googleExchangeRequests = new Map<string, Promise<AuthResponse>>()

export function loginApi(body: LoginRequest) {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body,
    skipAuth: true,
    skipRefresh: true,
  })
}

export function registerApi(body: RegisterRequest) {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body,
    skipAuth: true,
    skipRefresh: true,
  })
}

/** Request registration verification OTP for email. */
export function sendRegisterOtpApi(email: string) {
  return apiRequest<{ message: string }>('/auth/register/otp', {
    method: 'POST',
    body: { email },
    skipAuth: true,
    skipRefresh: true,
  })
}

/** Fresh profile from DB. */
export function getMeApi() {
  return apiRequest<User>('/auth/me')
}

export function updateProfileApi(body: { fullName: string; avatarUrl?: string | null }) {
  return apiRequest<User>('/auth/me', {
    method: 'PUT',
    body,
  })
}

export function deleteAvatarApi() {
  return apiRequest<User>('/auth/avatar', {
    method: 'DELETE',
  })
}

export function changePasswordApi(body: { currentPassword?: string; newPassword: string }) {
  return apiRequest<void>('/auth/password', {
    method: 'PUT',
    body,
  })
}

/** One-time code from BE after Google callback (09b B.1b). */
export function googleExchangeApi(code: string) {
  const inFlight = googleExchangeRequests.get(code)
  if (inFlight) return inFlight

  const request = apiRequest<AuthResponse>('/auth/google/exchange', {
    method: 'POST',
    body: { code },
    skipAuth: true,
    skipRefresh: true,
  })

  googleExchangeRequests.set(code, request)
  request.then(
    () => googleExchangeRequests.delete(code),
    () => googleExchangeRequests.delete(code),
  )
  return request
}

/** Password reset request — send OTP to email. */
export function sendPasswordResetOtpApi(email: string) {
  return apiRequest<{ message: string }>('/auth/forgot-password/otp', {
    method: 'POST',
    body: { email },
    skipAuth: true,
    skipRefresh: true,
  })
}

/** Verify OTP code for password reset. */
export function verifyPasswordResetOtpApi(email: string, otp: string) {
  return apiRequest<{ valid: boolean; token?: string }>('/auth/forgot-password/verify', {
    method: 'POST',
    body: { email, otp },
    skipAuth: true,
    skipRefresh: true,
  })
}

/** Reset password with verified OTP. */
export function resetPasswordWithOtpApi(email: string, otp: string, newPassword: string) {
  return apiRequest<{ message: string }>('/auth/forgot-password/reset', {
    method: 'POST',
    body: { email, otp, newPassword },
    skipAuth: true,
    skipRefresh: true,
  })
}

/** Password reset request (legacy link format). */
export function forgotPasswordApi(email: string) {
  return sendPasswordResetOtpApi(email)
}
