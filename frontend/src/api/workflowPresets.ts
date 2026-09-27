/**
 * W1 workflow preset API surface (docs/16 §7.5, WorkflowPresetController).
 * M-C scope added the read-only list for the create-job picker; the preset
 * admin milestone adds full CRUD (create/update/delete) for the settings page.
 * SYSTEM presets are read-only on every mutation endpoint (403).
 */
import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  WorkflowPreset,
  WorkflowPresetConfig,
  WorkflowPresetRequest,
  WorkflowPresetScope,
} from '@/types/media'

/**
 * GET /workspaces/{ws}/workflow-presets?scope=SYSTEM|WORKSPACE|PROJECT[&projectId=]
 * The backend list endpoint is scope-scoped; the picker fetches the three
 * scopes through {@link useWorkflowPresets} and filters active rows locally
 * (the backend exposes the `active` flag on every row).
 */
export function listWorkflowPresetsApi(
  workspaceId: string,
  scope: WorkflowPresetScope,
  projectId?: string,
): Promise<WorkflowPreset[]> {
  const params = new URLSearchParams({ scope })
  if (projectId) params.set('projectId', projectId)
  return apiRequest<Array<WorkflowPreset & { renderConfig?: WorkflowPresetConfig | null }>>(
    `${buildWorkspacePath(workspaceId, '/presets')}?${params.toString()}`,
  ).then((rows) =>
    // backend-main returns `renderConfig` (media_presets.render_config, same keys as the job
    // render-config); the picker reads it as `config`.
    rows.map(({ renderConfig, ...row }) => ({ ...row, config: row.config ?? renderConfig ?? null })),
  )
}

/** POST /workspaces/{ws}/presets */
export function createWorkflowPresetApi(
  workspaceId: string,
  body: WorkflowPresetRequest,
): Promise<WorkflowPreset> {
  return apiRequest<WorkflowPreset>(
    buildWorkspacePath(workspaceId, '/presets'),
    { method: 'POST', body },
  )
}

/** PUT /workspaces/{ws}/presets/{id} */
export function updateWorkflowPresetApi(
  workspaceId: string,
  presetId: string,
  body: WorkflowPresetRequest,
): Promise<WorkflowPreset> {
  return apiRequest<WorkflowPreset>(
    buildWorkspacePath(workspaceId, `/presets/${presetId}`),
    { method: 'PUT', body },
  )
}

/** DELETE /workspaces/{ws}/presets/{id} */
export function deleteWorkflowPresetApi(
  workspaceId: string,
  presetId: string,
): Promise<void> {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/presets/${presetId}`),
    { method: 'DELETE' },
  )
}
