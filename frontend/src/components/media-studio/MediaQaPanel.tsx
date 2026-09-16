import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCheck,
  IconShieldLock,
  IconSparkles,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { QaOverrideModal } from '@/components/qa/QaOverrideModal'
import { SeverityBadge } from '@/components/qa/SeverityBadge'
import { useMediaLinkedJob } from '@/hooks/useMedia'
import { useOverrideQaIssue, useResolveQaIssue } from '@/hooks/useJobs'
import { asSeverity, issueBlockingActions } from '@/lib/qa'
import { hasEffectiveBlockExport, hasEffectiveBlockRender } from '@/lib/media'
import { featureFlags } from '@/config/featureFlags'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/cn'
import { ApiError } from '@/types/api'
import type { MediaJob } from '@/types/media'
import type { BlockingAction, QaIssue } from '@/types/qa'
import type { SegmentItem } from '@/types/job'

type Props = {
  workspaceId: string
  job: MediaJob
  /** Review workbench: seeking to the cue that owns the clicked issue. */
  onSelectIssue?: (seg: SegmentItem) => void
}

/** Map backend severity enum → presentation band (HIGH / MEDIUM / LOW). CRITICAL → HIGH. */
export function severityBand(severity: string | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' {
  const s = asSeverity(severity)
  if (s === 'CRITICAL' || s === 'HIGH') return 'HIGH'
  if (s === 'MEDIUM') return 'MEDIUM'
  return 'LOW'
}

export function countIssuesByBand(issues: QaIssue[]): {
  high: number
  medium: number
  low: number
} {
  let high = 0
  let medium = 0
  let low = 0
  for (const issue of issues) {
    if (issue.resolved) continue
    const band = severityBand(issue.severity)
    if (band === 'HIGH') high += 1
    else if (band === 'MEDIUM') medium += 1
    else low += 1
  }
  return { high, medium, low }
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

/** Display order comparator: severity high → low, resolved always last, stable. */
function compareIssuesForDisplay(a: QaIssue, b: QaIssue): number {
  const aResolved = a.resolved ? 1 : 0
  const bResolved = b.resolved ? 1 : 0
  if (aResolved !== bResolved) return aResolved - bResolved
  return (
    (SEVERITY_RANK[String(b.severity).toUpperCase()] ?? 0)
    - (SEVERITY_RANK[String(a.severity).toUpperCase()] ?? 0)
  )
}

/**
 * Display order for the QA list: severity high → low (CRITICAL > HIGH > MEDIUM
 * > LOW), resolved issues always at the end. Stable sort — segments keep their
 * original order within the same severity.
 */
export function sortIssuesForDisplay(issues: QaIssue[]): QaIssue[] {
  return [...issues].sort(compareIssuesForDisplay)
}

export type QaBadgeSummary = {
  high: number
  medium: number
  low: number
}

/**
 * Accordion-trigger summary: per-severity-band open issue counts
 * (red = CRITICAL+HIGH, amber = MEDIUM, green = LOW) rendered as three
 * color-coded segments — the trigger shows every level at a glance.
 */
export function qaBadgeSummary(issues: QaIssue[]): QaBadgeSummary {
  return countIssuesByBand(issues)
}

/** Default page size before "show more" expands the QA list. */
export const QA_VISIBLE_LIMIT = 5

type IssuePair = { seg: SegmentItem; issue: QaIssue }

/**
 * Media QA panel — review workbench issue strip (docs/19 §1.8.2 redesign).
 * Compact actionable rows instead of the text-side table: Resolve applies the
 * suggestion (API existed for text; wired here), Override opens the shared
 * modal (Admin/PM, flag-gated). Clicking a row jumps to its cue.
 */
export function MediaQaPanel({ workspaceId, job, onSelectIssue }: Props) {
  const { t } = useTranslation(['media', 'job', 'common'])
  const { data: linkedJob, isLoading } = useMediaLinkedJob(workspaceId, job.translationJobId)
  const [expanded, setExpanded] = useState(false)
  const [overrideIssue, setOverrideIssue] = useState<QaIssue | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const resolve = useResolveQaIssue(workspaceId, job.translationJobId ?? undefined)
  const override = useOverrideQaIssue(workspaceId, job.translationJobId ?? undefined)
  const canResolve = usePermission('qa.resolve')
  const canOverride = usePermission('qa.override') && featureFlags.qaOverride

  const pairs: IssuePair[] = useMemo(
    () =>
      (linkedJob?.segments ?? []).flatMap((seg) =>
        (seg.qaIssues ?? []).map((issue) => ({ seg, issue })),
      ),
    [linkedJob],
  )

  const issues = useMemo(() => pairs.map((p) => p.issue), [pairs])
  const sortedPairs = useMemo(() => [...pairs].sort((a, b) => compareIssuesForDisplay(a.issue, b.issue)), [pairs])

  const bands = useMemo(() => countIssuesByBand(issues), [issues])
  const critical = issues.filter(
    (i) => !i.resolved && String(i.severity).toUpperCase() === 'CRITICAL',
  )
  const overlap = issues.filter(
    (i) => !i.resolved && String(i.type).toLowerCase() === 'subtitle_overlap',
  )
  const blockRender = hasEffectiveBlockRender(issues)
  const blockExport = hasEffectiveBlockExport(issues)
  const openTotal = bands.high + bands.medium + bands.low

  // Collapsed view shows the top open issues (severity first, resolved hidden);
  // the toggle reveals everything including resolved entries.
  const visible = expanded
    ? sortedPairs
    : sortedPairs.filter((p) => !p.issue.resolved).slice(0, QA_VISIBLE_LIMIT)
  const hiddenOpen = Math.max(0, openTotal - QA_VISIBLE_LIMIT)

  const handleResolve = (issueId: string, applySuggestion: boolean) => {
    setActionError(null)
    resolve.mutate(
      { issueId, body: { applySuggestion } },
      {
        onError: (e) =>
          setActionError(e instanceof ApiError ? e.message : t('common:error.generic')),
      },
    )
  }

  const handleOverride = (issueId: string, body: { blockingAction: BlockingAction; reason: string }) => {
    setActionError(null)
    override.mutate(
      { issueId, body },
      {
        onSuccess: () => setOverrideIssue(null),
        onError: (e) =>
          setActionError(e instanceof ApiError ? e.message : t('common:error.generic')),
      },
    )
  }

  if (!job.translationJobId) {
    return (
      <EmptyState
        icon={<IconShieldLock size={36} stroke={1.25} />}
        title={t('qa.waitTitle')}
        description={t('qa.waitDesc')}
        className="py-10"
      />
    )
  }

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
        {t('common:loading')}
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="media-qa-panel">
      {(critical.length > 0 || overlap.length > 0 || blockRender || blockExport) && (
        <div className="media-banner warn">
          <IconAlertTriangle size={18} />
          <div className="space-y-1 text-sm">
            {critical.length > 0 && (
              <p className="m-0 font-semibold">
                {t('qa.criticalCount', { count: critical.length })}
              </p>
            )}
            {overlap.length > 0 && (
              <p className="m-0">{t('qa.overlapHint', { count: overlap.length })}</p>
            )}
            {blockRender && <p className="m-0">{t('qa.blockRender')}</p>}
            {blockExport && <p className="m-0">{t('qa.blockExport')}</p>}
          </div>
        </div>
      )}

      {openTotal === 0 && (
        <p className="mb-0 text-sm text-[var(--color-text-tertiary)]">{t('qa.noneOpen')}</p>
      )}

      <div className="media-review-issue-list">
        {visible.map(({ seg, issue }) => {
          const actions = issueBlockingActions(issue)
          const overridden = new Set((issue.overrides ?? []).map((o) => o.blockingAction))
          const busy = resolve.isPending && resolve.variables?.issueId === issue.id
          const overriding = override.isPending && override.variables?.issueId === issue.id
          return (
            <div
              key={issue.id}
              className={cn('media-review-issue-row', issue.resolved && 'resolved')}
              data-testid={`review-issue-row-${issue.id}`}
            >
              <button
                type="button"
                className="media-review-issue-main"
                onClick={() => onSelectIssue?.(seg)}
                title={t('qa.jumpToCue', { seq: seg.seq })}
              >
                <SeverityBadge severity={issue.severity} showMediaNote />
                <span className="media-review-issue-type">{issue.type}</span>
                <span className="media-review-issue-msg">
                  {issue.message}
                  {issue.suggestion && (
                    <span className="media-review-issue-suggestion">
                      {t('job:qa.suggestion')}: {issue.suggestion}
                    </span>
                  )}
                </span>
                <span className="media-subtitle-seq">#{seg.seq}</span>
                <span className="flex flex-wrap gap-1">
                  {actions.map((a) => (
                    <span
                      key={a}
                      className={cn('chip chip-block', overridden.has(a) && 'chip-overridden')}
                      title={overridden.has(a) ? t('job:qa.overridden') : a}
                    >
                      {a.replace('BLOCK_', '')}
                    </span>
                  ))}
                </span>
              </button>
              {!issue.resolved && (
                <div className="media-review-issue-actions">
                  {canResolve && issue.suggestion && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => handleResolve(issue.id, true)}
                      title={t('job:qa.applyAndResolve')}
                    >
                      <IconSparkles size={13} />
                      {t('job:qa.apply')}
                    </button>
                  )}
                  {canResolve && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => handleResolve(issue.id, false)}
                    >
                      <IconCheck size={13} />
                      {t('job:qa.resolve')}
                    </button>
                  )}
                  {canOverride && actions.length > 0 && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={overriding}
                      onClick={() => setOverrideIssue(issue)}
                    >
                      {t('job:qa.override')}
                    </button>
                  )}
                </div>
              )}
              {issue.resolved && (
                <span className="media-review-issue-resolved">{t('job:qa.resolved')}</span>
              )}
            </div>
          )
        })}
      </div>

      {actionError && (
        <div className="media-banner warn">
          <p className="m-0 text-sm">{actionError}</p>
        </div>
      )}

      {sortedPairs.length > QA_VISIBLE_LIMIT && (
        <div className="flex justify-center">
          <button
            type="button"
            className="btn-media-secondary btn-sm"
            data-testid="qa-show-more"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t('qa.showLess')
              : t('qa.showMore', { count: Math.max(hiddenOpen, sortedPairs.length - QA_VISIBLE_LIMIT) })}
          </button>
        </div>
      )}

      {overrideIssue && (
        <QaOverrideModal
          open={!!overrideIssue}
          onClose={() => setOverrideIssue(null)}
          issue={overrideIssue}
          onSubmit={handleOverride}
          loading={override.isPending}
          error={actionError}
        />
      )}
    </div>
  )
}
