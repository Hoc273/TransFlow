import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCrown, IconSearch, IconShieldCheck, IconX } from '@tabler/icons-react'
import {
  SortableTh,
  avatarGradient,
  compareValues,
  toggleSort,
  type SortDir,
} from '@/components/platform/SortableTh'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformUsers } from '@/hooks/usePlatform'
import { formatDateTime, initialsFromName } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import type { PlatformUserItem } from '@/types/platform'

type SortKey = 'user' | 'status' | 'platform' | 'workspaces' | 'joined'

function statusBadgeClass(status: string) {
  const s = status?.toUpperCase() ?? ''
  if (s === 'ACTIVE') return 'platform-pill platform-pill-success'
  if (s === 'PENDING' || s === 'INVITED') return 'platform-pill platform-pill-warn'
  if (s === 'SUSPENDED' || s === 'DISABLED' || s === 'INACTIVE') return 'platform-pill platform-pill-muted'
  return 'platform-pill platform-pill-muted'
}

export function PlatformUsersPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')
  const [adminsOnly, setAdminsOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const size = 20

  const { data, isLoading, isError, refetch } = usePlatformUsers({
    q: qApplied || undefined,
    page,
    size,
    isPlatformAdmin: adminsOnly ? true : undefined,
  })

  useDocumentTitle(t('users.title'))

  const applySearch = () => {
    setPage(0)
    setQApplied(q.trim())
  }

  const clearSearch = () => {
    setQ('')
    setQApplied('')
    setPage(0)
  }

  const onSort = (key: SortKey) => {
    const next = toggleSort(sortKey, sortDir, key)
    setSortKey(next.key)
    setSortDir(next.dir)
  }

  const rows = useMemo(() => {
    const list = data?.content ? [...data.content] : []
    if (!sortKey) return list
    list.sort((a, b) => {
      switch (sortKey) {
        case 'user':
          return compareValues(
            `${a.fullName ?? ''} ${a.email}`.trim(),
            `${b.fullName ?? ''} ${b.email}`.trim(),
            sortDir,
          )
        case 'status':
          return compareValues(a.status, b.status, sortDir)
        case 'platform':
          return compareValues(a.isPlatformAdmin, b.isPlatformAdmin, sortDir)
        case 'workspaces':
          return compareValues(a.workspaceCount, b.workspaceCount, sortDir)
        case 'joined':
          return compareValues(a.createdAt, b.createdAt, sortDir)
        default:
          return 0
      }
    })
    return list
  }, [data?.content, sortKey, sortDir])

  return (
    <div className="platform-content">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('users.title')}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('users.subtitle')}</p>
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('users.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
          <div className="relative min-w-[240px] max-w-md flex-1">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              className="input w-full !pl-9 pr-8"
              placeholder={t('users.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch()
              }}
            />
            {q && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                title={t('common.clear', 'Xoá')}
                aria-label="Clear search"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              className="rounded border-[var(--color-border-strong)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              checked={adminsOnly}
              onChange={(e) => {
                setPage(0)
                setAdminsOnly(e.target.checked)
              }}
            />
            <span>{t('users.platformOnly')}</span>
          </label>
          <button type="button" className="btn-secondary py-2 text-xs" onClick={applySearch}>
            {t('overview.apply')}
          </button>
          <span className="ml-auto text-xs tabular-nums text-[var(--color-text-tertiary)]">
            {data ? t('pagination.total', { count: data.totalElements }) : '—'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <SortableTh
                  label={t('users.col.user')}
                  active={sortKey === 'user'}
                  dir={sortDir}
                  onSort={() => onSort('user')}
                />
                <SortableTh
                  label={t('users.col.status')}
                  active={sortKey === 'status'}
                  dir={sortDir}
                  onSort={() => onSort('status')}
                />
                <SortableTh
                  label={t('users.col.platformAdmin')}
                  active={sortKey === 'platform'}
                  dir={sortDir}
                  onSort={() => onSort('platform')}
                  align="center"
                />
                <SortableTh
                  label={t('users.col.workspaces')}
                  active={sortKey === 'workspaces'}
                  dir={sortDir}
                  onSort={() => onSort('workspaces')}
                  align="right"
                />
                <SortableTh
                  label={t('users.col.joined')}
                  active={sortKey === 'joined'}
                  dir={sortDir}
                  onSort={() => onSort('joined')}
                  className="col-hide-mobile"
                />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('users.empty')}
                  </td>
                </tr>
              ) : (
                rows.map((u) => <UserRow key={u.id} user={u} language={language} t={t} />)
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

function UserRow({
  user: u,
  language,
  t,
}: {
  user: PlatformUserItem
  language: string
  t: (k: string) => string
}) {
  const name = u.fullName || u.email
  const initials = initialsFromName(name)
  const grad = avatarGradient(u.email || u.id)

  return (
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold platform-avatar-text ring-2 ring-[var(--card)] ${grad}`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{name}</span>
              {u.isPlatformAdmin && (
                <IconShieldCheck size={14} className="shrink-0 text-[var(--color-accent)]" />
              )}
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {u.email}
            </div>
          </div>
        </div>
      </td>
      <td>
        <span className={statusBadgeClass(u.status)}>
          <span className="platform-pill-dot" />
          {u.status}
        </span>
      </td>
      <td className="text-center">
        {u.isPlatformAdmin ? (
          <span className="platform-pill platform-pill-brand inline-flex items-center gap-1">
            <IconCrown size={12} />
            {t('users.adminBadge')}
          </span>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">—</span>
        )}
      </td>
      <td className="text-right tabular-nums font-medium">{u.workspaceCount}</td>
      <td className="col-hide-mobile text-xs text-[var(--color-text-secondary)]">
        {formatDateTime(u.createdAt, language)}
      </td>
    </tr>
  )
}
