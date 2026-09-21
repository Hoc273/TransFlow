import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  assignProjectMemberApi,
  createProjectApi,
  listProjectMembersApi,
  listProjectsApi,
  removeProjectMemberApi,
} from '@/api/projects'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { AssignProjectMemberBody, CreateProjectBody } from '@/types/project'

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

export function useProjectMembers(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.projectMembers(workspaceId ?? '', projectId ?? ''),
    queryFn: () => listProjectMembersApi(workspaceId!, projectId!),
    enabled: Boolean(workspaceId && projectId),
    staleTime: STALE.static,
  })
}

export function useAssignProjectMember(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AssignProjectMemberBody) =>
      assignProjectMemberApi(workspaceId!, projectId!, body),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.projectMembers(workspaceId, projectId),
        })
      }
    },
  })
}

export function useRemoveProjectMember(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      removeProjectMemberApi(workspaceId!, projectId!, userId),
    onSuccess: () => {
      if (workspaceId && projectId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.projectMembers(workspaceId, projectId),
        })
      }
    },
  })
}

