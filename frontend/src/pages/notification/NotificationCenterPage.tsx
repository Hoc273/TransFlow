import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconChecks,
  IconX,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsInfinite,
  useUnreadNotificationCount,
} from '@/hooks/useNotifications'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { notificationHref, notificationTitle } from '@/lib/notifications'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { NotificationItem } from '@/types/notification'

function notificationIcon(type: string) {
  const t = type.toUpperCase()
  if (t === 'BATCH_COMPLETED' || t === 'JOB_COMPLETED')
    return <IconCheck size={18} className="text-[var(--color-success)]" />
  if (t === 'BATCH_PARTIALLY_FAILED' || t === 'JOB_NEEDS_RERUN' || t === 'JOB_QA_BLOCKED')
    return <IconAlertTriangle size={18} className="text-[var(--color-status-partial)]" />
  if (t === 'BATCH_FAILED' || t === 'JOB_FAILED') return <IconX size={18} className="text-[var(--color-error)]" />
  if (t === 'PROVIDER_KEY_INVALID')
    return <IconAlertTriangle size={18} className="text-[var(--color-error)]" />
  return <IconBell size={18} className="text-[var(--color-text-tertiary)]" />
}

type Filter = 'all' | 'unread'

/** B.6 Notification Center — paginated list with read/unread state and mark-as-read. */
export function NotificationCenterPage() {
  const { t } = useTranslation(['notification', 'common'])
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const language = useUiStore((s) => s.language)
  const [filter, setFilter] = useState<Filter>('all')
  useDocumentTitle(t('notification:title'))

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useNotificationsInfinite(workspaceId)
  const { data: unreadCount = 0 } = useUnreadNotificationCount(workspaceId)
  const markRead = useMarkNotificationRead(workspaceId)
  const markAllRead = useMarkAllNotificationsRead(workspaceId)

  const allItems = useMemo(
    () => data?.pages.flatMap((p) => p) ?? [],
    [data],
  )
  const items = filter === 'unread' ? allItems.filter((n) => !n.isRead) : allItems

  const openNotification = (n: NotificationItem) => {
    if (!n.isRead) markRead.mutate(n.id)
    const href = notificationHref(workspaceId, n)
    if (href) navigate(href)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('notification:title')}</h1>
        </div>
        <button
          type="button"
          className="btn-secondary flex items-center gap-1.5"
          disabled={unreadCount === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          <IconChecks size={16} />
          {t('notification:markAllRead')}
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2" role="tablist">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
            }`}
          >
            {t(`notification:filter.${f}`)}
            {f === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        ))}
      </div>

      <div className="app-card overflow-hidden">
        {isLoading && (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconBell size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <EmptyState
            icon={<IconBell size={40} stroke={1.25} />}
            title={filter === 'unread' ? t('notification:emptyUnread') : t('notification:emptyTitle')}
            className="py-14"
          />
        )}

        {!isLoading && !isError && items.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)]">
            {items.map((n) => {
              const href = notificationHref(workspaceId, n)
              return (
                <li
                  key={n.id}
                  className={n.isRead ? undefined : 'bg-[var(--color-accent-soft)]/40'}
                >
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-surface-2)]">
                      {notificationIcon(n.type)}
                    </div>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`min-w-0 flex-1 text-left ${href || !n.isRead ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {!n.isRead && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]"
                              aria-label={t('notification:unread')}
                            />
                          )}
                          <span
                            className={`text-[13px] text-[var(--color-text-primary)] ${
                              n.isRead ? 'font-medium' : 'font-semibold'
                            }`}
                          >
                            {notificationTitle(t, n)}
                          </span>
                        </div>
                        <time
                          className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]"
                          title={formatDateTime(n.createdAt, language)}
                        >
                          {formatRelativeTime(n.createdAt, language)}
                        </time>
                      </div>
                      {n.message && (
                        <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
                          {n.message}
                        </p>
                      )}
                    </button>
                    {!n.isRead && (
                      <button
                        type="button"
                        className="app-icon-btn shrink-0 cursor-pointer"
                        title={t('notification:markRead')}
                        aria-label={t('notification:markRead')}
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        <IconCheck size={16} />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {!isLoading && !isError && hasNextPage && (
          <div className="border-t border-[var(--color-border)] px-4 py-3 text-center">
            <button
              type="button"
              className="btn-secondary"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage
                ? t('notification:loadingMore')
                : t('notification:loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
