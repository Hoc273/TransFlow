import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconBell, IconChecks, IconChevronRight } from '@tabler/icons-react'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/useNotifications'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/format'
import { notificationHref, notificationTitle } from '@/lib/notifications'
import type { NotificationItem } from '@/types/notification'

export function NotificationPopover() {
  const { t } = useTranslation(['dashboard', 'common', 'notification'])
  const { workspaceId = '' } = useParams()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const language = useUiStore((s) => s.language)

  const navigate = useNavigate()
  const { data, isLoading } = useNotifications(workspaceId, { limit: 6, offset: 0 })
  const { data: unreadCount = 0 } = useUnreadNotificationCount(workspaceId)
  const markRead = useMarkNotificationRead(workspaceId)
  const markAllRead = useMarkAllNotificationsRead(workspaceId)
  const notifications = data ?? []

  const openNotification = (item: NotificationItem) => {
    if (!item.isRead) markRead.mutate(item.id)
    const href = notificationHref(workspaceId, item)
    if (href) {
      setOpen(false)
      navigate(href)
    }
  }

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        className="app-icon-btn relative cursor-pointer"
        title={t('common:nav.notifications')}
        aria-label={t('common:nav.notifications')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconBell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--color-bg-surface)]"
            aria-label={t('notification:unreadCount', { count: unreadCount })}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
          role="dialog"
          aria-label={t('common:nav.notifications')}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-bg-surface-2)]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('common:nav.notifications')}
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
                  {t('notification:unreadCount', { count: unreadCount })}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                <IconChecks size={14} />
                {t('notification:markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto divide-y divide-[var(--color-border)]">
            {isLoading && (
              <div className="py-8 text-center text-xs text-[var(--color-text-tertiary)]">
                {t('dashboard:loading')}
              </div>
            )}

            {!isLoading && notifications.length === 0 && (
              <div className="py-8 px-4 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-surface-2)] text-[var(--color-text-tertiary)]">
                  <IconBell size={20} stroke={1.5} />
                </div>
                <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {t('dashboard:widget.notifications.emptyTitle')}
                </div>
              </div>
            )}

            {!isLoading &&
              notifications.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => openNotification(item)}
                  className={`block w-full cursor-pointer px-4 py-3 text-left transition hover:bg-[var(--color-bg-hover)] ${
                    item.isRead ? '' : 'bg-[var(--color-accent-soft)]/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {!item.isRead && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]"
                            aria-label={t('notification:unread')}
                          />
                        )}
                        <span
                          className={`truncate text-xs text-[var(--color-text-primary)] ${
                            item.isRead ? 'font-medium' : 'font-semibold'
                          }`}
                        >
                          {notificationTitle(t, item)}
                        </span>
                      </div>
                      {item.message && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                          {item.message}
                        </p>
                      )}
                    </div>
                    <time className="shrink-0 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                      {formatRelativeTime(item.createdAt, language)}
                    </time>
                  </div>
                </button>
              ))}
          </div>

          <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-2">
            <Link
              to={`/w/${workspaceId}/notifications`}
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-[var(--color-accent)] transition hover:bg-[var(--color-accent-soft)] no-underline"
            >
              <span>{t('dashboard:viewAll')}</span>
              <IconChevronRight size={14} />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
