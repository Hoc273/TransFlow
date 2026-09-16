import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { CreateProjectBody, Project } from '@/types/project'

export function listProjectsApi(workspaceId: string) {
  return apiRequest<Project[]>(buildWorkspacePath(workspaceId, '/projects'))
}

export function createProjectApi(workspaceId: string, body: CreateProjectBody) {
  return apiRequest<Project>(buildWorkspacePath(workspaceId, '/projects'), {
    method: 'POST',
    body,
  })
}
