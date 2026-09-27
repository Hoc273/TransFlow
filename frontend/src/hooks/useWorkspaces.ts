import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createWorkspaceApi, listWorkspacesApi } from '@/api/workspaces'
import { STALE, queryKeys } from '@/lib/queryClient'
import { useAuthStore } from '@/store/authStore'
import type { CreateWorkspaceRequest, Workspace } from '@/types/workspace'

export function sortWorkspacesBySavedOrder(list: Workspace[]): Workspace[] {
  try {
    const raw = localStorage.getItem('tf-workspaces-order')
    if (raw) {
      const order: string[] = JSON.parse(raw)
      return [...list].sort((a, b) => {
        const idxA = order.indexOf(a.id)
        const idxB = order.indexOf(b.id)
        if (idxA === -1 && idxB === -1) return 0
        if (idxA === -1) return 1
        if (idxB === -1) return -1
        return idxA - idxB
      })
    }
  } catch {
    /* ignore */
  }
  return list
}

export function useWorkspaces(options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: async () => {
      const list = await listWorkspacesApi()
      return sortWorkspacesBySavedOrder(list)
    },
    staleTime: STALE.static,
    enabled: options?.enabled ?? !!token,
  })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  const setCurrentWorkspace = useAuthStore((s) => s.setCurrentWorkspace)

  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) => createWorkspaceApi(body),
    onSuccess: (ws) => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces })
      setCurrentWorkspace(ws)
    },
  })
}
