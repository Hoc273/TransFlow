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
