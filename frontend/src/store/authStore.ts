import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types/auth'
import type { Workspace } from '@/types/workspace'
import type { Role } from '@/lib/permissions'
import { isRole } from '@/lib/permissions'
import { apiBaseUrl } from '@/config/featureFlags'

const LAST_WORKSPACE_KEY = 'tf-last-workspace'

/**
 * The refresh token is never visible to JS: the backend keeps it in an HttpOnly,
 * SameSite=Strict cookie scoped to /api/auth (see lib/api/client.ts refresh flow).
 */
interface AuthState {
  accessToken: string | null
  user: User | null
  currentWorkspace: Workspace | null
  /** Derived from currentWorkspace.myRole for convenience. */
  role: Role | null
  setSession: (payload: { accessToken: string; user: User }) => void
  setAccessToken: (accessToken: string) => void
  setUser: (user: User) => void
  setCurrentWorkspace: (workspace: Workspace | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      currentWorkspace: null,
      role: null,
      setSession: ({ accessToken, user }) => set({ accessToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
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
      logout: () => {
        revokeRefreshCookie()
        set({
          accessToken: null,
          user: null,
          currentWorkspace: null,
          role: null,
        })
      },
    }),
    {
      name: 'tf-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
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
        // Drop the refresh token older builds persisted in localStorage.
        const { refreshToken: _legacyRefresh, ...rest } = p as Partial<AuthState> & { refreshToken?: unknown }
        void _legacyRefresh
        return {
          ...current,
          ...rest,
          currentWorkspace: workspace,
          role,
        }
      },
    },
  ),
)

/** Ask the backend to expire the HttpOnly refresh cookie (JS cannot delete it itself). */
function revokeRefreshCookie() {
  try {
    void fetch(`${apiBaseUrl}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
  } catch {
    /* fetch unavailable (tests/SSR) */
  }
}

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
