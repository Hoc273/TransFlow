import { useState } from 'react'
import { useParams } from 'react-router-dom'
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
import { useNotifications } from '@/hooks/useNotifications'
import { formatRelativeTime } from '@/lib/format'
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

  const query = (useNotifications as any)(wsId)
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [allMarkedAsRead, setAllMarkedAsRead] = useState(false)

  // Defensively extract notifications list supporting both { data } and { notifications }
  const notifications: any[] =
    query?.notifications ??
    query?.data?.pages?.flatMap?.((p: any) => p) ??
    query?.data ??
    (Array.isArray(query) ? query : [])
  const isLoading = Boolean(query?.isLoading)

  const handleMarkAllAsRead = () => {
    if (typeof query?.markAllAsRead === 'function') {
      query.markAllAsRead()
    }
    setAllMarkedAsRead(true)
  }

  const markItemAsRead = (id: string) => {
    setReadIds((prev) => new Set(prev).add(id))
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">Thông báo</h1>
        <button
          type="button"
          onClick={handleMarkAllAsRead}
          className="flex h-9 shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary active:opacity-75 transition-opacity cursor-pointer"
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
            const isRead = allMarkedAsRead || Boolean(n.read || n.isRead || readIds.has(n.id))
            const timeDisplay =
              n.time ??
              (n.createdAt ? formatRelativeTime(n.createdAt, language) : '')

            return (
              <MobileCard
                key={n.id}
                onClick={() => markItemAsRead(n.id)}
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
                      title={n.title}
                    >
                      {n.title}
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
        </div>
      )}
    </div>
  )
}
