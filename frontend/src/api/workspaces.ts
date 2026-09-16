import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { CreateWorkspaceRequest, Workspace } from '@/types/workspace'

export function listWorkspacesApi() {
  return apiRequest<Workspace[]>('/workspaces')
}

export function getWorkspaceApi(workspaceId: string) {
  return apiRequest<Workspace>(buildWorkspacePath(workspaceId))
}

export function createWorkspaceApi(body: CreateWorkspaceRequest) {
  return apiRequest<Workspace>('/workspaces', { method: 'POST', body })
}
