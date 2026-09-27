import type { BlockingAction, QaIssue, QaSeverity } from '@/types/qa'

/** Text-MVP default blocking actions by severity when BE omits blocking_actions (06b). */
export function defaultBlockingActions(severity: QaSeverity): BlockingAction[] {
  const s = String(severity).toUpperCase()
  if (s === 'HIGH') return ['BLOCK_TM_WRITEBACK', 'BLOCK_APPROVAL']
  if (s === 'CRITICAL') return ['BLOCK_RENDER']
  return []
}

export function issueBlockingActions(issue: QaIssue): BlockingAction[] {
  if (issue.blockingActions && issue.blockingActions.length > 0) {
    return issue.blockingActions
  }
  return defaultBlockingActions(issue.severity)
}

export function isApprovalBlocked(issues: QaIssue[] | undefined | null): boolean {
  if (!issues?.length) return false
  return issues.some((i) => {
    if (i.resolved) return false
    const actions = issueBlockingActions(i)
    if (actions.includes('BLOCK_APPROVAL')) {
      const overridden = i.overrides?.some((o) => o.blockingAction === 'BLOCK_APPROVAL')
      return !overridden
    }
    // Fallback when no actions: HIGH unresolved blocks approve (docs/06)
    return String(i.severity).toUpperCase() === 'HIGH'
  })
}

export function asSeverity(value: string | undefined | null): QaSeverity {
  const s = String(value ?? 'LOW').toUpperCase()
  if (s === 'LOW' || s === 'MEDIUM' || s === 'HIGH' || s === 'CRITICAL') return s
  return 'LOW'
}

export function openIssues(issues: QaIssue[] | undefined | null): QaIssue[] {
  return (issues ?? []).filter((i) => !i.resolved)
}

/** Normalize raw backend QaIssueResponse (or partial UI issue) to canonical QaIssue. */
export function normalizeQaIssue(raw: any): QaIssue {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      type: '',
      severity: 'LOW',
      message: '',
      sourceSpan: null,
      targetSpan: null,
      suggestion: null,
      resolved: false,
    }
  }

  let detailObj: Record<string, unknown> = {}
  if (typeof raw.detail === 'string') {
    try {
      detailObj = JSON.parse(raw.detail)
    } catch {
      detailObj = { message: raw.detail }
    }
  } else if (raw.detail && typeof raw.detail === 'object') {
    detailObj = raw.detail
  }

  const issueType = String(raw.issueType || raw.type || '')
  const message = String(raw.message || detailObj.message || detailObj.reason || issueType || 'QA Issue')
  const suggestion = (raw.suggestion ?? detailObj.suggestion ?? null) as string | null
  const resolved = Boolean(raw.resolved ?? (raw.resolvedAt != null))

  return {
    ...raw,
    id: String(raw.id || ''),
    type: issueType,
    issueType,
    severity: asSeverity(raw.severity),
    message,
    sourceSpan: (raw.sourceSpan ?? detailObj.sourceSpan ?? null) as string | null,
    targetSpan: (raw.targetSpan ?? detailObj.targetSpan ?? null) as string | null,
    suggestion,
    resolved,
    blockingActions: (raw.blockingActions ?? []) as BlockingAction[],
    subtitleSegmentId: raw.subtitleSegmentId ? String(raw.subtitleSegmentId) : undefined,
    resolvedAt: raw.resolvedAt ?? null,
    createdAt: raw.createdAt,
  }
}
