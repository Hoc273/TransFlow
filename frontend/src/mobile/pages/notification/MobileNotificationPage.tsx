import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconBell,
  IconCheck,
  IconCircleCheck,
  IconInfoCircle,
  IconX,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { MobileCard } from '../../components/MobileCard'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsInfinite,
  useUnreadNotificationCount,
} from '@/hooks/useNotifications'
import { formatRelativeTime } from '@/lib/format'
import { notificationHref, notificationTitle } from '@/lib/notifications'
import type { NotificationItem } from '@/types/notification'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'

function getNotificationIcon(type?: string) {
  const t = (type || '').toUpperCase()
  if (t.includes('COMPLETED') || t.includes('SUCCESS')) {
    return <IconCircleCheck size={18} className="text-green-500 shrink-0" />
  }
  if (t.includes('FAIL') || t.includes('ERROR')) {
    return <IconX size={18} className="text-red-500 shrink-0" />
  }
  if (t.includes('WARN') || t.includes('PARTIAL')) {
    return <IconAlertTriangle size={18} className="text-amber-500 shrink-0" />
  }
  return <IconInfoCircle size={18} className="text-primary shrink-0" />
}

export function MobileNotificationPage() {
  const { workspaceId } = useParams()
  const currentWorkspaceId = useAuthStore((s) => s.currentWorkspace?.id)
  const wsId = workspaceId ?? currentWorkspaceId
  const language = useUiStore((s) => s.language) ?? 'vi'

  const { t } = useTranslation('notification')
  const navigate = useNavigate()
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useNotificationsInfinite(wsId)
  const { data: unreadCount = 0 } = useUnreadNotificationCount(wsId)
  const markRead = useMarkNotificationRead(wsId)
  const markAllRead = useMarkAllNotificationsRead(wsId)
  const notifications = useMemo(() => data?.pages.flatMap((p) => p) ?? [], [data])

  const openNotification = (n: NotificationItem) => {
    if (!n.isRead) markRead.mutate(n.id)
    const href = notificationHref(wsId ?? '', n)
    if (href) navigate(href)
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">Thông báo</h1>
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={unreadCount === 0 || markAllRead.isPending}
          className="flex h-9 shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary active:opacity-75 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <IconCheck size={14} />
          <span>Đọc tất cả</span>
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải thông báo...</div>
      ) : notifications.length === 0 ? (
        <MobileEmptyState
          icon={<IconBell size={36} />}
          title="Không có thông báo mới"
          description="Bạn sẽ nhận được thông báo khi tiến trình dịch hoặc media hoàn tất."
        />
      ) : (
        <div className="min-w-0 space-y-2">
          {notifications.map((n) => {
            const isRead = n.isRead
            const timeDisplay = n.createdAt ? formatRelativeTime(n.createdAt, language) : ''
            const title = notificationTitle(t, n)

            return (
              <MobileCard
                key={n.id}
                onClick={() => openNotification(n)}
                className={clsx(
                  'min-w-0 space-y-1.5 p-3.5 transition-colors cursor-pointer',
                  isRead
                    ? 'bg-white dark:bg-neutral-900 opacity-80'
                    : 'bg-primary/5 dark:bg-primary/10 border-primary/20 dark:border-primary/30'
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {getNotificationIcon(n.type)}
                    <span
                      className={clsx(
                        'min-w-0 flex-1 truncate text-sm',
                        isRead
                          ? 'font-medium text-neutral-800 dark:text-neutral-200'
                          : 'font-semibold text-neutral-900 dark:text-white'
                      )}
                      title={title}
                    >
                      {title}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isRead && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-primary"
                        aria-label="Chưa đọc"
                        title="Chưa đọc"
                      />
                    )}
                    {timeDisplay && (
                      <span className="whitespace-nowrap text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
                        {timeDisplay}
                      </span>
                    )}
                  </div>
                </div>

                {n.message && (
                  <p className="min-w-0 pl-6 text-xs leading-relaxed break-words text-neutral-600 dark:text-neutral-400 line-clamp-3">
                    {n.message}
                  </p>
                )}
              </MobileCard>
            )
          })}
          {hasNextPage && (
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="h-10 w-full text-xs font-semibold text-primary active:opacity-75 cursor-pointer"
            >
              {isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
