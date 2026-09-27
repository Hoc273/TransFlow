import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addMemberApi,
  listMembersApi,
  removeMemberApi,
  updateMemberRoleApi,
} from '@/api/members'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { AddMemberRequest, UpdateMemberRoleRequest } from '@/types/member'

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.members(workspaceId ?? ''),
    queryFn: () => listMembersApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.static,
  })
}

export function useAddMember(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AddMemberRequest) => addMemberApi(workspaceId!, body),
    onSuccess: () => {
      if (workspaceId) void qc.invalidateQueries({ queryKey: queryKeys.members(workspaceId) })
    },
  })
}

export function useUpdateMemberRole(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, body }: { memberId: string; body: UpdateMemberRoleRequest }) =>
      updateMemberRoleApi(workspaceId!, memberId, body),
    onSuccess: () => {
      if (workspaceId) void qc.invalidateQueries({ queryKey: queryKeys.members(workspaceId) })
    },
  })
}

export function useRemoveMember(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) => removeMemberApi(workspaceId!, memberId),
    onSuccess: () => {
      if (workspaceId) void qc.invalidateQueries({ queryKey: queryKeys.members(workspaceId) })
    },
  })
}
