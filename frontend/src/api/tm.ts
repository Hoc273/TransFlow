import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { TmQueryParams, TmQueryResponse } from '@/types/tm'

export function queryTmApi(workspaceId: string, params: TmQueryParams) {
  const search = new URLSearchParams()
  search.set('sl', params.sl)
  search.set('tl', params.tl)
  if (params.source?.trim()) search.set('source', params.source.trim())
  return apiRequest<TmQueryResponse>(
    buildWorkspacePath(workspaceId, `/tm?${search.toString()}`),
  )
}

export function deleteTmEntryApi(workspaceId: string, id: string) {
  return apiRequest<void>(buildWorkspacePath(workspaceId, `/tm/${id}`), {
    method: 'DELETE',
  })
}
