import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { HistoryEvent } from '@/types/history'
import type { SegmentItem, UpdateSegmentBody } from '@/types/job'
import type { OverrideQaIssueBody, ResolveIssueBody } from '@/types/qa'

export function updateSegmentApi(
  workspaceId: string,
  segmentId: string,
  body: UpdateSegmentBody,
) {
  return apiRequest<SegmentItem>(
    buildWorkspacePath(workspaceId, `/segments/${segmentId}`),
    { method: 'PATCH', body },
  )
}

export function approveSegmentApi(workspaceId: string, segmentId: string) {
  return apiRequest<SegmentItem>(
    buildWorkspacePath(workspaceId, `/segments/${segmentId}/approve`),
    { method: 'POST' },
  )
}

export function runSegmentQaApi(
  workspaceId: string,
  segmentId: string,
  autoFix = false,
) {
  const q = autoFix ? '?autoFix=true' : ''
  return apiRequest(
    buildWorkspacePath(workspaceId, `/segments/${segmentId}/qa${q}`),
    { method: 'POST' },
  )
}

export function resolveQaIssueApi(
  workspaceId: string,
  issueId: string,
  body: ResolveIssueBody = {},
) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/qa-issues/${issueId}/resolve`),
    { method: 'POST', body: { applySuggestion: !!body.applySuggestion } },
  )
}

export function segmentHistoryApi(workspaceId: string, segmentId: string) {
  return apiRequest<HistoryEvent[]>(
    buildWorkspacePath(workspaceId, `/segments/${segmentId}/history`),
  )
}

export function overrideQaIssueApi(
  workspaceId: string,
  issueId: string,
  body: OverrideQaIssueBody,
) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/qa-issues/${issueId}/override`),
    { method: 'POST', body },
  )
}

import { normalizeQaIssue } from '@/lib/qa'
import type { QaIssue } from '@/types/qa'

/** GET /api/workspaces/{workspaceId}/media/jobs/{jobId}/qa-issues (QaController) */
export async function listMediaJobQaIssuesApi(
  workspaceId: string,
  jobId: string,
  resolved?: boolean,
): Promise<QaIssue[]> {
  const query = resolved != null ? `?resolved=${resolved}` : ''
  const rawList = await apiRequest<any[]>(
    buildWorkspacePath(workspaceId, `/media/jobs/${jobId}/qa-issues${query}`),
  )
  return (rawList || []).map(normalizeQaIssue)
}

