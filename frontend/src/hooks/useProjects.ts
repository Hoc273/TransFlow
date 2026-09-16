import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createProjectApi, listProjectsApi } from '@/api/projects'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { CreateProjectBody } from '@/types/project'

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects(workspaceId ?? ''),
    queryFn: () => listProjectsApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.static,
  })
}

export function useCreateProject(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProjectBody) => createProjectApi(workspaceId!, body),
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({ queryKey: queryKeys.projects(workspaceId) })
      }
    },
  })
}
