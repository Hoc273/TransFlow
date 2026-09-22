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
