import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { UsageSummary } from '@/types/dashboard'

export type UsageQuery = {
  projectId?: string
  documentId?: string
  jobId?: string
}

export function getUsageApi(workspaceId: string, query: UsageQuery = {}) {
  const search = new URLSearchParams()
  if (query.projectId) search.set('projectId', query.projectId)
  if (query.documentId) search.set('documentId', query.documentId)
  if (query.jobId) search.set('jobId', query.jobId)
  const qs = search.toString()
  const path = buildWorkspacePath(workspaceId, `/dashboard/usage${qs ? `?${qs}` : ''}`)
  return apiRequest<UsageSummary>(path)
}
