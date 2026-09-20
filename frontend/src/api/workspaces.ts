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

