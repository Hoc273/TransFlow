import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCheck,
  IconFilter,
  IconSparkles,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { QaOverrideModal } from '@/components/qa/QaOverrideModal'
import { SeverityBadge } from '@/components/qa/SeverityBadge'
import { featureFlags } from '@/config/featureFlags'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/cn'
import { issueBlockingActions, openIssues } from '@/lib/qa'
import type { BlockingAction, QaIssue } from '@/types/qa'

type Props = {
  issues: QaIssue[]
  dense?: boolean
  className?: string
  onResolve?: (issueId: string, applySuggestion: boolean) => void
  resolvingId?: string | null
  /** Compact mode for Editor side panel */
  compact?: boolean
  /** Override callback — receives issueId + body */
  onOverride?: (issueId: string, body: { blockingAction: BlockingAction; reason: string }) => void
  overridingId?: string | null
  overrideError?: string | null
}

/** D.3 QA Issues Panel — document/job/segment scoped (no workspace list). */
export function QaIssuePanel({
  issues,
  dense = true,
  className,
  onResolve,
  resolvingId,
  compact = false,
  onOverride,
  overridingId,
  overrideError,
}: Props) {
  const { t } = useTranslation(['job', 'common'])
  const canResolve = usePermission('qa.resolve')
  const canOverride = usePermission('qa.override')
  const [showResolved, setShowResolved] = useState(false)
  const [overrideIssue, setOverrideIssue] = useState<QaIssue | null>(null)

  const visible = useMemo(() => {
    if (showResolved) return issues
    return openIssues(issues)
  }, [issues, showResolved])

  const openCount = openIssues(issues).length

  return (
    <div className={cn('qa-panel', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">
          {t('job:qa.title')}
          <span className="ml-2 font-mono text-[12px] font-normal text-[var(--color-text-tertiary)]">
            {openCount}/{issues.length}
          </span>
        </div>
        <button
          type="button"
          className={cn('btn-ghost btn-sm', showResolved && 'text-[var(--color-accent)]')}
          onClick={() => setShowResolved((v) => !v)}
        >
          <IconFilter size={14} />
          {showResolved ? t('job:qa.hideResolved') : t('job:qa.showResolved')}
        </button>
      </div>

      {visible.length === 0 && (
        <EmptyState
          icon={<IconSparkles size={compact ? 28 : 36} stroke={1.25} />}
          title={t('job:qa.emptyTitle')}
          description={t('job:qa.emptyDesc')}
          className={compact ? 'py-6' : 'py-10'}
        />
      )}

      {visible.length > 0 && (
        <div className={cn(dense && 'overflow-x-auto')}>
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('job:qa.col.type')}</th>
                <th>{t('job:qa.col.severity')}</th>
                {!compact && <th>{t('job:qa.col.message')}</th>}
                <th>{t('job:qa.col.blocking')}</th>
                <th>{t('job:qa.col.state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((issue) => (
                <QaIssueRow
                  key={issue.id}
                  issue={issue}
                  compact={compact}
                  canResolve={canResolve}
                  canOverride={canOverride && featureFlags.qaOverride}
                  resolving={resolvingId === issue.id}
                  overriding={overridingId === issue.id}
                  onResolve={onResolve}
                  onOpenOverride={() => setOverrideIssue(issue)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {overrideIssue && onOverride && (
        <QaOverrideModal
          open={!!overrideIssue}
          onClose={() => setOverrideIssue(null)}
          issue={overrideIssue}
          onSubmit={onOverride}
          loading={overridingId === overrideIssue.id}
          error={overrideError}
        />
      )}
    </div>
  )
}

function QaIssueRow({
  issue,
  compact,
  canResolve,
  canOverride,
  resolving,
  overriding,
  onResolve,
  onOpenOverride,
}: {
  issue: QaIssue
  compact: boolean
  canResolve: boolean
  canOverride: boolean
  resolving: boolean
  overriding: boolean
  onResolve?: (issueId: string, applySuggestion: boolean) => void
  onOpenOverride?: () => void
}) {
  const { t } = useTranslation('job')
  const actions = issueBlockingActions(issue)
  const overridden = new Set(
    (issue.overrides ?? []).map((o) => o.blockingAction),
  )

  return (
    <tr className={cn(issue.resolved && 'opacity-60')}>
      <td className="font-mono text-[12px]">{issue.type}</td>
      <td>
        <SeverityBadge severity={issue.severity} showMediaNote />
      </td>
      {!compact && (
        <td className="max-w-[280px] text-[13px] text-[var(--color-text-secondary)]">
          <div className="line-clamp-2">{issue.message}</div>
          {issue.suggestion && (
            <div className="mt-1 text-[12px] text-[var(--color-accent)]">
              {t('qa.suggestion')}: {issue.suggestion}
            </div>
          )}
        </td>
      )}
      <td>
        <div className="flex flex-wrap gap-1">
          {actions.length === 0 && (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">—</span>
          )}
          {actions.map((a) => (
            <span
              key={a}
              className={cn(
                'chip chip-block',
                overridden.has(a) && 'chip-overridden',
              )}
              title={overridden.has(a) ? t('qa.overridden') : a}
            >
              {a.replace('BLOCK_', '')}
              {overridden.has(a) && ` · ${t('qa.overriddenShort')}`}
            </span>
          ))}
        </div>
      </td>
      <td>
        {issue.resolved ? (
          <span className="phase-badge">{t('qa.resolved')}</span>
        ) : (
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {t('qa.open')}
          </span>
        )}
      </td>
      <td className="text-right">
        <div className="flex flex-wrap justify-end gap-1">
          {canResolve && !issue.resolved && onResolve && (
            <>
              {issue.suggestion && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={resolving}
                  onClick={() => onResolve(issue.id, true)}
                  title={t('qa.applyAndResolve')}
                >
                  <IconSparkles size={14} />
                  {t('qa.apply')}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={resolving}
                onClick={() => onResolve(issue.id, false)}
              >
                <IconCheck size={14} />
                {t('qa.resolve')}
              </button>
            </>
          )}
          {/* Override only when flag + permission; never fake (09b D.3) */}
          {canOverride && !issue.resolved && actions.length > 0 && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={overriding}
              onClick={onOpenOverride}
            >
              {t('qa.override')}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
