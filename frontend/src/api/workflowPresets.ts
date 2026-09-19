/**
 * W1 workflow preset API surface (docs/16 §7.5, WorkflowPresetController).
 * M-C scope added the read-only list for the create-job picker; the preset
 * admin milestone adds full CRUD (create/update/delete) for the settings page.
 * SYSTEM presets are read-only on every mutation endpoint (403).
 */
import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  WorkflowPreset,
  WorkflowPresetRequest,
  WorkflowPresetScope,
} from '@/types/media'

/**
 * GET /workspaces/{ws}/workflow-presets?scope=SYSTEM|WORKSPACE|PROJECT[&projectId=]
 * The backend list endpoint is scope-scoped; the picker fetches the three
 * scopes through {@link useWorkflowPresets} and filters active rows locally
 * (the backend exposes the `active` flag on every row).
 */
function normalizePreset(p: any): WorkflowPreset {
  return {
    ...p,
    description: p.description ?? null,
    schemaVersion: p.schemaVersion ?? 1,
    config: p.config ?? {
      ...(p.renderConfig || {}),
      presentation: p.renderConfig?.presentation ?? null,
      ttsVoiceId: p.voiceConfig?.ttsVoiceId ?? null,
      ttsProviderId: p.voiceConfig?.ttsProviderId ?? null,
    },
  }
}

export async function listWorkflowPresetsApi(
  workspaceId: string,
  scope: WorkflowPresetScope,
  projectId?: string,
): Promise<WorkflowPreset[]> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('projectId', projectId)
  const list = await apiRequest<any[]>(
    `${buildWorkspacePath(workspaceId, '/presets')}?${params.toString()}`,
  )
  return (list || []).map(normalizePreset)
}

/** POST /workspaces/{ws}/presets — LEAD/MEMBER only. */
export async function createWorkflowPresetApi(
  workspaceId: string,
  body: WorkflowPresetRequest,
): Promise<WorkflowPreset> {
  const res = await apiRequest<any>(
    buildWorkspacePath(workspaceId, '/presets'),
    { method: 'POST', body },
  )
  return normalizePreset(res)
}

/** PUT /workspaces/{ws}/presets/{id} — partial update. */
export async function updateWorkflowPresetApi(
  workspaceId: string,
  presetId: string,
  body: WorkflowPresetRequest,
): Promise<WorkflowPreset> {
  const res = await apiRequest<any>(
    buildWorkspacePath(workspaceId, `/presets/${presetId}`),
    { method: 'PUT', body },
  )
  return normalizePreset(res)
}

/** DELETE /workspaces/{ws}/presets/{id} — hard delete. */
export function deleteWorkflowPresetApi(
  workspaceId: string,
  presetId: string,
): Promise<void> {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/presets/${presetId}`),
    { method: 'DELETE' },
  )
}
