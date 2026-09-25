import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCircleCheck, IconPencil } from '@tabler/icons-react'
import { QaOverrideModal } from '@/components/qa/QaOverrideModal'
import { SeverityBadge } from '@/components/qa/SeverityBadge'
import { useMediaJobQaIssues, useMediaSubtitles, useOverrideQaIssue } from '@/hooks/useMedia'
import { asSeverity, issueBlockingActions } from '@/lib/qa'
import { hasEffectiveBlockExport, hasEffectiveBlockRender, subtitleToSegmentItem } from '@/lib/media'
import { featureFlags } from '@/config/featureFlags'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/cn'
import { formatTimecode } from '@/lib/timecode'
import { ApiError } from '@/types/api'
import type { MediaJob } from '@/types/media'
import type { BlockingAction, QaIssue } from '@/types/qa'
import type { SegmentItem } from '@/types/media'

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

/** CRITICAL timing overlaps are never overridable backend-side (OVERRIDE_NOT_ALLOWED). */
export function isUnskippableIssue(issue: QaIssue): boolean {
  return (
    String(issue.type).toLowerCase() === 'subtitle_overlap' &&
    String(issue.severity).toUpperCase() === 'CRITICAL'
  )
}

/** Render-blocking issues first, then severity; resolved last (stable). */
function compareForReview(a: IssuePair, b: IssuePair): number {
  const aResolved = a.issue.resolved ? 1 : 0
  const bResolved = b.issue.resolved ? 1 : 0
  if (aResolved !== bResolved) return aResolved - bResolved
  const aBlocks = hasEffectiveBlockRender([a.issue]) ? 0 : 1
  const bBlocks = hasEffectiveBlockRender([b.issue]) ? 0 : 1
  if (aBlocks !== bBlocks) return aBlocks - bBlocks
  return compareIssuesForDisplay(a.issue, b.issue)
}

/**
 * Media QA panel — review workbench issue list. The summary says what blocks
 * the job and how to unblock it; every row names the subtitle it is about and
 * offers the two ways out: edit the subtitle (saving clears its findings
 * backend-side) or skip the check with a recorded reason.
 */
export function MediaQaPanel({ workspaceId, job, onSelectIssue }: Props) {
  const { t } = useTranslation(['media', 'job', 'common'])
  const { data: subtitles = [], isLoading: subtitlesLoading } = useMediaSubtitles(workspaceId, job.id)
  const { data: qaIssues = [], isLoading: issuesLoading } = useMediaJobQaIssues(workspaceId, job.id)
  const [expanded, setExpanded] = useState(false)
  const [overrideIssue, setOverrideIssue] = useState<QaIssue | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const override = useOverrideQaIssue(workspaceId, job.id)
  const canOverride = usePermission('qa.override') && featureFlags.qaOverride

  const pairs: IssuePair[] = useMemo(
    () =>
      subtitles.map((subtitle) => subtitleToSegmentItem(subtitle, qaIssues)).flatMap((seg) =>
        (seg.qaIssues ?? []).map((issue) => ({ seg, issue })),
      ),
    [subtitles, qaIssues],
  )

  const issues = useMemo(() => pairs.map((p) => p.issue), [pairs])
  const sortedPairs = useMemo(() => [...pairs].sort(compareForReview), [pairs])

  const bands = useMemo(() => countIssuesByBand(issues), [issues])
  const blocking = sortedPairs.filter((p) => hasEffectiveBlockRender([p.issue]))
  const blockExport = hasEffectiveBlockExport(issues)
  const openTotal = bands.high + bands.medium + bands.low
  const otherOpen = openTotal - blocking.length

  // Collapsed view shows the top open issues (blocking first, resolved hidden);
  // the toggle reveals everything including resolved entries.
  const visible = expanded
    ? sortedPairs
    : sortedPairs.filter((p) => !p.issue.resolved).slice(0, QA_VISIBLE_LIMIT)
  const hiddenOpen = Math.max(0, openTotal - QA_VISIBLE_LIMIT)

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

  if (subtitlesLoading || issuesLoading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
        {t('common:loading')}
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="media-qa-panel">
      {blocking.length > 0 && (
        <div className="media-banner warn" data-testid="qa-blocking-summary">
          <IconAlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p className="m-0 font-semibold">
              {t('qa.blockingTitle', { count: blocking.length })}
            </p>
            <p className="m-0">{t('qa.blockingHelp')}</p>
            {otherOpen > 0 && <p className="m-0">{t('qa.otherOpen', { count: otherOpen })}</p>}
            {blockExport && <p className="m-0">{t('qa.blockExport')}</p>}
          </div>
          {onSelectIssue && (
            <button
              type="button"
              className="btn-media-secondary btn-sm shrink-0 whitespace-nowrap"
              data-testid="qa-first-blocking"
              onClick={() => onSelectIssue(blocking[0].seg)}
            >
              {t('qa.firstIssue')}
            </button>
          )}
        </div>
      )}

      {openTotal === 0 && (
        <p className="media-qa-clear m-0" data-testid="qa-none-open">
          <IconCircleCheck size={14} />
          {t('qa.noneOpen')}
        </p>
      )}

      <div className="media-review-issue-list">
        {visible.map(({ seg, issue }) => {
          const actions = issueBlockingActions(issue)
          const overridden = new Set((issue.overrides ?? []).map((o) => o.blockingAction))
          const overriding = override.isPending && override.variables?.issueId === issue.id
          const typeKey = String(issue.type ?? '').toLowerCase()
          const unskippable = isUnskippableIssue(issue)
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
                <span className="media-review-issue-head">
                  <SeverityBadge severity={issue.severity} showMediaNote />
                  <span className="media-review-issue-type">
                    {t(`qa.types.${typeKey}`, { defaultValue: issue.type })}
                  </span>
                  <span className="media-review-issue-where">
                    {t('qa.lineAt', { seq: seg.seq, time: formatTimecode(seg.startMs ?? 0) })}
                  </span>
                </span>
                {seg.targetText && (
                  <span className="media-review-issue-cue">“{seg.targetText}”</span>
                )}
                <span className="media-review-issue-msg">
                  {issue.message}
                  {issue.suggestion && (
                    <span className="media-review-issue-suggestion">
                      {t('job:qa.suggestion')}: {issue.suggestion}
                    </span>
                  )}
                </span>
              </button>
              <div className="media-review-issue-foot">
                <span className="flex flex-wrap gap-1">
                  {actions.map((a) => (
                    <span
                      key={a}
                      className={cn('chip chip-block', overridden.has(a) && 'chip-overridden')}
                      title={overridden.has(a) ? t('job:qa.overridden') : a}
                    >
                      {t(`qa.blocks.${a}`, { defaultValue: a.replace('BLOCK_', '') })}
                    </span>
                  ))}
                </span>
                {!issue.resolved && (
                  <div className="media-review-issue-actions">
                    <button
                      type="button"
                      className="btn-media-secondary btn-sm"
                      data-testid={`qa-fix-${issue.id}`}
                      onClick={() => onSelectIssue?.(seg)}
                    >
                      <IconPencil size={13} />
                      {t('qa.fixCue')}
                    </button>
                    {canOverride && actions.length > 0 && !unskippable && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={overriding}
                        data-testid={`qa-skip-${issue.id}`}
                        onClick={() => setOverrideIssue(issue)}
                      >
                        {t('qa.skipCheck')}
                      </button>
                    )}
                  </div>
                )}
                {!issue.resolved && unskippable && (
                  <span className="media-review-issue-note">{t('qa.overlapNotSkippable')}</span>
                )}
                {issue.resolved && (
                  <span className="media-review-issue-resolved">{t('job:qa.resolved')}</span>
                )}
              </div>
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
