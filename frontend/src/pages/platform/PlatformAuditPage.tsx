import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClock, IconCpu, IconLock, IconSearch, IconX } from '@tabler/icons-react'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { avatarGradient } from '@/components/platform/SortableTh'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformAuditLogs } from '@/hooks/usePlatform'
import { formatDateTime, initialsFromName } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import type { PlatformAuditLogItem } from '@/types/platform'

const ACTION_FILTERS = [
  { value: '', labelKey: 'audit.all' as const },
  { value: 'VIEW_OVERVIEW', labelKey: 'audit.viewOverview' as const },
  { value: 'VIEW_STATUS', labelKey: 'audit.viewStatus' as const },
  { value: 'LIST_USERS', labelKey: 'audit.listUsers' as const },
  { value: 'LIST_WORKSPACES', labelKey: 'audit.listWs' as const },
  { value: 'LIST_AUDIT', labelKey: 'audit.listAudit' as const },
  { value: 'VIEW_USER_CREDIT', labelKey: 'audit.viewUserCredit' as const },
  { value: 'ADJUST_USER_CREDIT', labelKey: 'audit.adjustUserCredit' as const },
  { value: 'SEED_GRANT', labelKey: 'audit.seedGrant' as const },
  { value: 'VIEW_PRICING', labelKey: 'audit.viewPricing' as const },
  { value: 'PREVIEW_PRICING', labelKey: 'audit.previewPricing' as const },
  { value: 'CREATE_PRICING', labelKey: 'audit.createPricing' as const },
  { value: 'DENIED', labelKey: 'audit.denied' as const },
] as const

type StatusFilter = 'all' | '2xx' | '4xx' | '5xx'

function actionBadgeClass(action: string) {
  switch (action) {
    case 'VIEW_OVERVIEW':
      return 'platform-action-badge platform-action-brand'
    case 'VIEW_STATUS':
      return 'platform-action-badge platform-action-purple'
    case 'LIST_USERS':
      return 'platform-action-badge platform-action-amber'
    case 'LIST_WORKSPACES':
      return 'platform-action-badge platform-action-cyan'
    case 'LIST_AUDIT':
      return 'platform-action-badge platform-action-slate'
    case 'ADJUST_USER_CREDIT':
      return 'platform-action-badge platform-action-amber'
    case 'SEED_GRANT':
      return 'platform-action-badge platform-action-success'
    case 'CREATE_PRICING':
      return 'platform-action-badge platform-action-amber'
    case 'DENIED':
      return 'platform-action-badge platform-action-danger'
    default:
      return 'platform-action-badge platform-action-slate'
  }
}

function statusCodeClass(code: number) {
  if (code >= 200 && code < 300) return 'font-semibold tabular-nums platform-code-ok'
  if (code >= 400 && code < 500) return 'font-semibold tabular-nums platform-code-warn'
  if (code >= 500) return 'font-semibold tabular-nums platform-code-err'
  return 'font-semibold tabular-nums text-[var(--color-text-tertiary)]'
}

function matchesStatus(code: number, filter: StatusFilter) {
  if (filter === 'all') return true
  if (filter === '2xx') return code >= 200 && code < 300
  if (filter === '4xx') return code >= 400 && code < 500
  if (filter === '5xx') return code >= 500
  return true
}

export function PlatformAuditPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const currentUser = useAuthStore((s) => s.user)
  const [action, setAction] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const size = 20

  const { data, isLoading, isError, refetch } = usePlatformAuditLogs({
    action: action || undefined,
    page,
    size,
  })

  useDocumentTitle(t('audit.title'))

  const rows = useMemo(() => {
    const list = data?.content ?? []
    const needle = q.trim().toLowerCase()
    return list.filter((row) => {
      if (!matchesStatus(row.statusCode, statusFilter)) return false
      if (!needle) return true
      const hay = [
        row.action,
        row.httpMethod,
        row.path,
        row.queryString ?? '',
        row.ip ?? '',
        row.actorUserId ?? '',
        String(row.statusCode),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [data?.content, q, statusFilter])

  const actorLabel = (row: PlatformAuditLogItem) => {
    if (!row.actorUserId) return t('audit.system')
    if (currentUser?.id === row.actorUserId) {
      return currentUser.email || currentUser.fullName || row.actorUserId
    }
    return row.actorUserId
  }

  return (
    <div className="platform-content">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('audit.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex items-center gap-1.5 rounded-lg platform-immutable-badge px-3 py-1.5 font-medium">
            <IconLock size={14} />
            {t('audit.immutable')}
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--elevated)] px-3 py-1.5 font-medium text-[var(--color-text-secondary)]">
            <IconClock size={14} />
            {t('audit.retention')}
          </div>
        </div>
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('audit.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            {ACTION_FILTERS.map((f) => {
              const active = action === f.value
              const isDenied = f.value === 'DENIED'
              return (
                <button
                  key={f.value || 'all'}
                  type="button"
                  className={[
                    'rounded-md px-3 py-1.5 text-xs font-medium transition',
                    active
                      ? isDenied
                        ? 'platform-filter-active-destructive'
                        : 'platform-filter-active-brand'
                      : isDenied
                        ? 'platform-filter-inactive-destructive'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
                  ].join(' ')}
                  onClick={() => {
                    setPage(0)
                    setAction(f.value)
                  }}
                >
                  {t(f.labelKey)}
                </button>
              )
            })}
            <span className="ml-auto text-xs tabular-nums text-[var(--color-text-tertiary)]">
              {data
                ? t('audit.entriesCount', { count: data.totalElements })
                : t('audit.entriesCount', { count: 0 })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] max-w-md flex-1">
              <IconSearch
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                className="input w-full !pl-9 pr-8"
                placeholder={t('audit.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={t('audit.search')}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                  title={t('common.clear', 'Xoá')}
                  aria-label="Clear search"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
            <select
              className="input !w-auto min-w-[140px]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label={t('audit.statusFilter')}
            >
              <option value="all">{t('audit.statusAll')}</option>
              <option value="2xx">{t('audit.status2xx')}</option>
              <option value="4xx">{t('audit.status4xx')}</option>
              <option value="5xx">{t('audit.status5xx')}</option>
            </select>
            {(q || statusFilter !== 'all') && (
              <span className="text-[11px] text-[var(--color-text-tertiary)]">
                {t('audit.clientFilterNote', { shown: rows.length, total: data?.content.length ?? 0 })}
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="platform-table platform-table-mono">
            <thead>
              <tr>
                <th>{t('audit.createdAt')}</th>
                <th>{t('audit.actor')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('audit.method')}</th>
                <th>{t('audit.path')}</th>
                <th className="text-center">{t('audit.statusCode')}</th>
                <th className="col-hide-mobile">{t('audit.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('audit.empty')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const label = actorLabel(row)
                  const isSystem = !row.actorUserId
                  const pathFull = row.queryString
                    ? `${row.path}?${row.queryString}`
                    : row.path
                  return (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap text-[var(--color-text-secondary)]">
                        {formatDateTime(row.createdAt, language)}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {isSystem ? (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full platform-avatar-system">
                              <IconCpu size={12} />
                            </div>
                          ) : (
                            <div
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold platform-avatar-text ${avatarGradient(label)}`}
                            >
                              {initialsFromName(
                                currentUser?.id === row.actorUserId
                                  ? currentUser.fullName || label
                                  : label,
                              )}
                            </div>
                          )}
                          <span
                            className={[
                              'max-w-[160px] truncate',
                              isSystem ? 'italic text-[var(--color-text-secondary)]' : '',
                            ].join(' ')}
                            title={label}
                          >
                            {label}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={actionBadgeClass(row.action)}>{row.action}</span>
                      </td>
                      <td>
                        <span className="rounded platform-http-badge px-1.5 py-0.5 font-medium">
                          {row.httpMethod || '—'}
                        </span>
                      </td>
                      <td className="max-w-[260px] truncate text-[var(--color-text-secondary)]" title={pathFull}>
                        {pathFull}
                      </td>
                      <td className="text-center">
                        <span className={statusCodeClass(row.statusCode)}>
                          {row.statusCode || '—'}
                        </span>
                      </td>
                      <td className="col-hide-mobile text-[var(--color-text-secondary)]">
                        {row.ip ?? '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {data && (
          <div className="border-t border-[var(--color-border)] px-4 py-3">
            <PlatformPagination
              page={data.page}
              totalPages={data.totalPages}
              totalElements={data.totalElements}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
