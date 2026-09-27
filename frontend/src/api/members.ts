import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { AddMemberRequest, UpdateMemberRoleRequest, WorkspaceMember } from '@/types/member'

export function listMembersApi(workspaceId: string) {
  return apiRequest<WorkspaceMember[]>(buildWorkspacePath(workspaceId, '/members'))
}

export function addMemberApi(workspaceId: string, body: AddMemberRequest) {
  return apiRequest<WorkspaceMember>(buildWorkspacePath(workspaceId, '/members'), {
    method: 'POST',
    body,
  })
}

export function updateMemberRoleApi(
  workspaceId: string,
  memberId: string,
  body: UpdateMemberRoleRequest,
) {
  return apiRequest<WorkspaceMember>(buildWorkspacePath(workspaceId, `/members/${memberId}`), {
    method: 'PUT',
    body,
  })
}

export function removeMemberApi(workspaceId: string, memberId: string) {
  return apiRequest<void>(buildWorkspacePath(workspaceId, `/members/${memberId}`), {
    method: 'DELETE',
  })
}
