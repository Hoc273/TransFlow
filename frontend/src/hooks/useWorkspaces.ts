import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createWorkspaceApi, listWorkspacesApi } from '@/api/workspaces'
import { STALE, queryKeys } from '@/lib/queryClient'
import { useAuthStore } from '@/store/authStore'
import type { CreateWorkspaceRequest } from '@/types/workspace'

export function useWorkspaces(options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: listWorkspacesApi,
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
