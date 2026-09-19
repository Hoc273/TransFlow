import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { CreateWorkspaceRequest, Workspace } from '@/types/workspace'

export async function listWorkspacesApi() {
  const list = await apiRequest<(Workspace & { role?: any })[]>('/workspaces')
  return (list || []).map((ws) => ({
    ...ws,
    myRole: ws.myRole || ws.role || 'MEMBER',
  }))
}

export async function getWorkspaceApi(workspaceId: string) {
  const ws = await apiRequest<Workspace & { role?: any }>(buildWorkspacePath(workspaceId))
  if (!ws) return ws
  return {
    ...ws,
    myRole: ws.myRole || ws.role || 'MEMBER',
  }
}

export async function createWorkspaceApi(body: CreateWorkspaceRequest) {
  const ws = await apiRequest<Workspace & { role?: any }>('/workspaces', { method: 'POST', body })
  return {
    ...ws,
    myRole: ws.myRole || ws.role || 'LEAD',
  }
}
