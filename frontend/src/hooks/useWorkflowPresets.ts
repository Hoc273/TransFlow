/**
 * W1 workflow preset hooks (docs/16 §7.5). The list is shared by the
 * create-job picker (M-C) and the preset settings page (admin milestone);
 * mutations invalidate the same query key. Presets change rarely
 * (admin-managed) — static staleTime, no polling.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createWorkflowPresetApi,
  deleteWorkflowPresetApi,
  listWorkflowPresetsApi,
  updateWorkflowPresetApi,
} from '@/api/workflowPresets'
import { queryKeys, STALE } from '@/lib/queryClient'
import type { WorkflowPreset, WorkflowPresetRequest } from '@/types/media'

export function useWorkflowPresets(
  workspaceId: string,
  projectId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.workflowPresets(workspaceId, projectId ?? ''),
    queryFn: async (): Promise<WorkflowPreset[]> => {
      const [system, workspace, project] = await Promise.all([
        listWorkflowPresetsApi(workspaceId, 'SYSTEM'),
        listWorkflowPresetsApi(workspaceId, 'WORKSPACE'),
        projectId
          ? listWorkflowPresetsApi(workspaceId, 'PROJECT', projectId)
          : Promise.resolve([]),
      ])
      return [...system, ...workspace, ...project]
    },
    enabled: Boolean(workspaceId && enabled),
    staleTime: STALE.static,
  })
}

function useInvalidatePresets(workspaceId: string, projectId?: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({
      queryKey: queryKeys.workflowPresets(workspaceId, projectId ?? ''),
    })
    void qc.invalidateQueries({ queryKey: queryKeys.workflowPresets(workspaceId, '') })
  }
}

export function useCreateWorkflowPreset(workspaceId: string, projectId?: string) {
  const invalidate = useInvalidatePresets(workspaceId, projectId)
  return useMutation({
    mutationFn: (body: WorkflowPresetRequest) => createWorkflowPresetApi(workspaceId, body),
    onSuccess: invalidate,
  })
}

export function useUpdateWorkflowPreset(workspaceId: string, projectId?: string) {
  const invalidate = useInvalidatePresets(workspaceId, projectId)
  return useMutation({
    mutationFn: (args: { presetId: string; body: WorkflowPresetRequest }) =>
      updateWorkflowPresetApi(workspaceId, args.presetId, args.body),
    onSuccess: invalidate,
  })
}

export function useDeleteWorkflowPreset(workspaceId: string, projectId?: string) {
  const invalidate = useInvalidatePresets(workspaceId, projectId)
  return useMutation({
    mutationFn: (presetId: string) => deleteWorkflowPresetApi(workspaceId, presetId),
    onSuccess: invalidate,
  })
}
