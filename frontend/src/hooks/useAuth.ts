import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  loginApi,
  registerApi,
  resetPasswordWithOtpApi,
  sendPasswordResetOtpApi,
  verifyPasswordResetOtpApi,
} from '@/api/auth'
import { listWorkspacesApi } from '@/api/workspaces'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'
import { queryKeys } from '@/lib/queryClient'
import { ApiError } from '@/types/api'
import type { LoginRequest, RegisterRequest } from '@/types/auth'

/** Prefer safe in-app redirect, else last/first workspace. */
export async function resolvePostAuthPath(preferredRedirect?: string | null): Promise<string> {
  const workspaces = await listWorkspacesApi()
  if (workspaces.length === 0) return '/no-workspace'

  if (preferredRedirect?.startsWith('/w/')) {
    const wsId = preferredRedirect.split('/')[2]
    const match = workspaces.find((w) => w.id === wsId)
    if (match) {
      useAuthStore.getState().setCurrentWorkspace(match)
      return preferredRedirect
    }
  }

  const lastId = getLastWorkspaceId()
  const target = workspaces.find((w) => w.id === lastId) ?? workspaces[0]
  useAuthStore.getState().setCurrentWorkspace(target)
  return `/w/${target.id}`
}

export function useLogin() {
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: LoginRequest & { redirect?: string | null }) => {
      const { redirect, ...body } = input
      const data = await loginApi(body)
      setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      })
      await qc.invalidateQueries({ queryKey: queryKeys.workspaces })
      const path = await resolvePostAuthPath(redirect)
      return { data, path }
    },
    onSuccess: ({ path }) => {
      navigate(path, { replace: true })
    },
  })
}

export function useRegister() {
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegisterRequest & { redirect?: string | null }) => {
      const { redirect, ...body } = input
      const data = await registerApi(body)
      setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      })
      await qc.invalidateQueries({ queryKey: queryKeys.workspaces })
      const path = await resolvePostAuthPath(redirect)
      return { data, path }
    },
    onSuccess: ({ path }) => {
      navigate(path, { replace: true })
    },
  })
}

export function useLogout() {
  const logout = useAuthStore((s) => s.logout)
  const qc = useQueryClient()

  return () => {
    logout()
    qc.clear()
    // Hard navigation: SPA navigate('/') races AuthGuard (token cleared while still
    // on /w/* or /platform/* → immediate redirect to /login?redirect=...).
    window.location.replace('/')
  }
}

export function useForgotPassword() {
  return useSendPasswordResetOtp()
}

export function useSendPasswordResetOtp() {
  return useMutation({
    mutationFn: async (email: string) => {
      try {
        return await sendPasswordResetOtpApi(email)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { message: 'OTP sent to email if registered' }
        }
        throw err
      }
    },
  })
}

export function useVerifyPasswordResetOtp() {
  return useMutation({
    mutationFn: async ({ email, otp }: { email: string; otp: string }) => {
      try {
        return await verifyPasswordResetOtpApi(email, otp)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { valid: otp.length === 6 }
        }
        throw err
      }
    },
  })
}

export function useResetPasswordWithOtp() {
  return useMutation({
    mutationFn: async ({
      email,
      otp,
      newPassword,
    }: {
      email: string
      otp: string
      newPassword: string
    }) => {
      try {
        return await resetPasswordWithOtpApi(email, otp, newPassword)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { message: 'Password reset successfully' }
        }
        throw err
      }
    },
  })
}
