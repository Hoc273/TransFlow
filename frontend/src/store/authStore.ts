import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types/auth'
import type { Workspace } from '@/types/workspace'
import type { Role } from '@/lib/permissions'
import { isRole } from '@/lib/permissions'

const LAST_WORKSPACE_KEY = 'tf-last-workspace'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  currentWorkspace: Workspace | null
  /** Derived from currentWorkspace.myRole for convenience. */
  role: Role | null
  setSession: (payload: {
    accessToken: string
    refreshToken: string
    user: User
  }) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  setUser: (user: User) => void
  setCurrentWorkspace: (workspace: Workspace | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      currentWorkspace: null,
      role: null,
      setSession: ({ accessToken, refreshToken, user }) =>
        set({ accessToken, refreshToken, user }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      setCurrentWorkspace: (workspace) => {
        if (workspace?.id) {
          try {
            localStorage.setItem(LAST_WORKSPACE_KEY, workspace.id)
          } catch {
            /* ignore quota */
          }
        }
        set({
          currentWorkspace: workspace,
          role: workspace && isRole(workspace.myRole) ? workspace.myRole : null,
        })
      },
      logout: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          currentWorkspace: null,
          role: null,
        }),
    }),
    {
      name: 'tf-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        currentWorkspace: state.currentWorkspace,
        role: state.role,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>
        const workspace = p.currentWorkspace ?? null
        const role =
          workspace && isRole(workspace.myRole)
            ? workspace.myRole
            : isRole(p.role)
              ? p.role
              : null
        return {
          ...current,
          ...p,
          currentWorkspace: workspace,
          role,
        }
      },
    },
  ),
)

export function getLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}

export function clearAuthAndRedirect(loginPath = '/login') {
  useAuthStore.getState().logout()
  const here = `${window.location.pathname}${window.location.search}`
  const redirect =
    here.startsWith('/login') || here.startsWith('/register')
      ? ''
      : `?redirect=${encodeURIComponent(here)}`
  window.location.assign(`${loginPath}${redirect}`)
}
