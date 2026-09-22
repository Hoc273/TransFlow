import { useTranslation } from 'react-i18next'
import { IconHistory } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useSegmentHistory } from '@/hooks/useJobs'
import { formatDateTime } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'

type Props = {
  workspaceId: string
  segmentId: string | null
}

/** D.4 History panel — append-only, no rollback (Q-VER1). */
export function HistoryPanel({ workspaceId, segmentId }: Props) {
  const { t } = useTranslation(['job', 'common'])
  const language = useUiStore((s) => s.language)
  const { data = [], isLoading, isError } = useSegmentHistory(
    workspaceId,
    segmentId ?? undefined,
  )

  if (!segmentId) {
    return (
      <EmptyState
        icon={<IconHistory size={28} stroke={1.25} />}
        title={t('job:history.pickSegment')}
        className="py-8"
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

  if (isError) {
    return (
      <EmptyState
        icon={<IconHistory size={28} stroke={1.25} />}
        title={t('common:error.loadFailed')}
        className="py-8"
      />
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={<IconHistory size={28} stroke={1.25} />}
        title={t('job:history.emptyTitle')}
        description={t('job:history.emptyDesc')}
        className="py-8"
      />
    )
  }

  return (
    <ul className="history-timeline">
      {data.map((ev) => (
        <li key={ev.id} className="history-item">
          <div className="flex flex-wrap items-center gap-2">
            <span className="phase-badge">{ev.action}</span>
            <span className="text-[12px] text-[var(--color-text-tertiary)]">
              {ev.actorType === 'AI'
                ? t('job:history.actorAi')
                : ev.actorName || t('job:history.actorHuman')}
            </span>
            <span className="text-[12px] text-[var(--color-text-tertiary)]">
              {formatDateTime(ev.createdAt, language)}
            </span>
          </div>
          {(ev.oldValue || ev.newValue) && (
            <div className="mt-1 grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
              {ev.oldValue != null && (
                <div className="line-clamp-2">
                  <span className="text-[var(--color-text-tertiary)]">− </span>
                  {ev.oldValue}
                </div>
              )}
              {ev.newValue != null && (
                <div className="line-clamp-2">
                  <span className="text-[var(--color-success)]">+ </span>
                  {ev.newValue}
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
