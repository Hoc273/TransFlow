import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  AssignProjectMemberBody,
  CreateProjectBody,
  Project,
  ProjectMember,
} from '@/types/project'

export function listProjectsApi(workspaceId: string) {
  return apiRequest<Project[]>(buildWorkspacePath(workspaceId, '/projects'))
}

export function createProjectApi(workspaceId: string, body: CreateProjectBody) {
  return apiRequest<Project>(buildWorkspacePath(workspaceId, '/projects'), {
    method: 'POST',
    body,
  })
}

export function listProjectMembersApi(workspaceId: string, projectId: string) {
  return apiRequest<ProjectMember[]>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/members`),
  )
}

export function assignProjectMemberApi(
  workspaceId: string,
  projectId: string,
  body: AssignProjectMemberBody,
) {
  return apiRequest<ProjectMember>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/members`),
    {
      method: 'POST',
      body,
    },
  )
}

export function removeProjectMemberApi(
  workspaceId: string,
  projectId: string,
  userId: string,
) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/members/${userId}`),
    {
      method: 'DELETE',
    },
  )
}

