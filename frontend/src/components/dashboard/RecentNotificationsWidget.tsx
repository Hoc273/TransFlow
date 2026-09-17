import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconBell } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useNotifications } from '@/hooks/useNotifications'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/format'
import { ApiError } from '@/types/api'

/** Recent notifications — GET /workspaces/{ws}/notifications?limit=5 (poll 30s). */
export function RecentNotificationsWidget() {
  const { t } = useTranslation('dashboard')
  const { workspaceId = '' } = useParams()
  const language = useUiStore((s) => s.language)
  const { data, isLoading, isError, error, isFetching } = useNotifications(workspaceId, {
    limit: 5,
    offset: 0,
  })

  const items = data ?? []

  return (
    <div className="app-card h-full" aria-busy={isLoading || isFetching}>
      <div className="app-card-header">
        <div className="app-card-title">
          <IconBell size={18} className="text-[var(--color-accent)]" />
          {t('widget.notifications.title')}
        </div>
        <Link to={`/w/${workspaceId}/notifications`} className="btn-ghost-sm">
          {t('viewAll')}
        </Link>
      </div>

      {isLoading && (
        <div className="py-10 text-center text-xs text-[var(--color-text-tertiary)]">
          {t('loading')}
        </div>
      )}

      {isError && !isLoading && (
        <EmptyState
          icon={<IconBell size={36} stroke={1.25} />}
          title={t('widget.notifications.loadError')}
          description={error instanceof ApiError ? error.message : undefined}
          className="py-10"
        />
      )}

      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={<IconBell size={36} stroke={1.25} />}
          title={t('widget.notifications.emptyTitle')}
          description={t('widget.notifications.emptyDesc')}
          className="py-10"
        />
      )}

      {!isLoading && !isError && items.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.map((n) => (
            <li key={n.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                    {n.title}
                  </div>
                  {n.message && (
                    <div className="mt-0.5 line-clamp-2 text-[12px] text-[var(--color-text-secondary)]">
                      {n.message}
                    </div>
                  )}
                  <div className="mt-1">
                    <span className="phase-badge">{n.type}</span>
                  </div>
                </div>
                <time className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                  {formatRelativeTime(n.createdAt, language)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
