import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconChevronRight,
  IconX,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNotificationsInfinite } from '@/hooks/useNotifications'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { NotificationItem } from '@/types/notification'

function notificationIcon(type: string) {
  const t = type.toUpperCase()
  if (t === 'BATCH_COMPLETED') return <IconCheck size={18} className="text-[var(--color-success)]" />
  if (t === 'BATCH_PARTIALLY_FAILED')
    return <IconAlertTriangle size={18} className="text-[var(--color-status-partial)]" />
  if (t === 'BATCH_FAILED') return <IconX size={18} className="text-[var(--color-error)]" />
  return <IconBell size={18} className="text-[var(--color-text-tertiary)]" />
}

function batchDetailPath(workspaceId: string, n: NotificationItem): string | null {
  const type = (n.relatedEntityType || '').toUpperCase()
  if (type === 'BATCH' && n.relatedEntityId) {
    return `/w/${workspaceId}/batches/${n.relatedEntityId}`
  }
  // Fallback: BATCH_* types often relate to batch entity
  if (n.type?.toUpperCase().startsWith('BATCH_') && n.relatedEntityId) {
    return `/w/${workspaceId}/batches/${n.relatedEntityId}`
  }
  return null
}

/** B.6 Notification Center — read-only BATCH_* list, load more, no mark-as-read. */
export function NotificationCenterPage() {
  const { t } = useTranslation(['notification', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
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

  const items = useMemo(
    () => data?.pages.flatMap((p) => p) ?? [],
    [data],
  )

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('notification:title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{t('notification:title')}</h1>
          <div className="page-subtitle">{t('notification:subtitle')}</div>
        </div>
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
            title={t('notification:emptyTitle')}
            description={t('notification:emptyDesc')}
            className="py-14"
          />
        )}

        {!isLoading && !isError && items.length > 0 && (
          <>
            <ul className="divide-y divide-[var(--color-border)]">
              {items.map((n) => {
                const href = batchDetailPath(workspaceId, n)
                const body = (
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-surface-2)]">
                      {notificationIcon(n.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                          {n.title}
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
                      <div className="mt-1.5">
                        <span className="phase-badge">{n.type}</span>
                      </div>
                    </div>
                  </div>
                )

                return (
                  <li key={n.id} className={href ? 'hover:bg-[var(--color-bg-hover)]' : undefined}>
                    {href ? (
                      <Link to={href} className="block no-underline text-inherit">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                )
              })}
            </ul>

            {hasNextPage && (
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
          </>
        )}
      </div>
    </div>
  )
}
