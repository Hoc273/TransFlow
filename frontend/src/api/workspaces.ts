import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { CreateWorkspaceRequest, Workspace } from '@/types/workspace'

function normalizeWorkspace(ws: any): Workspace {
  if (!ws) return ws
  const resolvedRole = ws.myRole ?? ws.role ?? 'MEMBER'
  return {
    ...ws,
    myRole: resolvedRole,
    role: ws.role ?? resolvedRole,
  }
}

export async function listWorkspacesApi(): Promise<Workspace[]> {
  const data = await apiRequest<Workspace[]>('/workspaces')
  return (data || []).map(normalizeWorkspace)
}

export async function getWorkspaceApi(workspaceId: string): Promise<Workspace> {
  const data = await apiRequest<Workspace>(buildWorkspacePath(workspaceId))
  return normalizeWorkspace(data)
}

export async function createWorkspaceApi(body: CreateWorkspaceRequest): Promise<Workspace> {
  const data = await apiRequest<Workspace>('/workspaces', { method: 'POST', body })
  return normalizeWorkspace(data)
}

export type CostMode = 'WORKSPACE_OWNER' | 'INDIVIDUAL_USER'

export type WorkspaceBillingConfig = {
  costMode: CostMode
}

export function getWorkspaceBillingConfigApi(workspaceId: string) {
  return apiRequest<WorkspaceBillingConfig>(buildWorkspacePath(workspaceId, '/billing-config'))
}

export function updateWorkspaceBillingConfigApi(
  workspaceId: string,
  body: { costMode: CostMode },
) {
  return apiRequest<WorkspaceBillingConfig>(
    buildWorkspacePath(workspaceId, '/billing-config'),
    { method: 'PUT', body },
  )
}
