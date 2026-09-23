import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconSearch, IconUser, IconX } from '@tabler/icons-react'
import {
  SortableTh,
  avatarGradient,
  compareValues,
  toggleSort,
  type SortDir,
} from '@/components/platform/SortableTh'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { Modal } from '@/components/shared/Modal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformOverview, usePlatformWorkspaces } from '@/hooks/usePlatform'
import { formatDateTime, formatNumber, initialsFromName } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import type { PlatformWorkspaceItem } from '@/types/platform'

type SortKey = 'name' | 'slug' | 'owner' | 'members' | 'createdAt'

function rangeIso(days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function PlatformWorkspacesPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selected, setSelected] = useState<PlatformWorkspaceItem | null>(null)
  const size = 20

  const weekRange = useMemo(() => rangeIso(7), [])
  const { data: overview, isLoading: overviewLoading } = usePlatformOverview({
    from: weekRange.from,
    to: weekRange.to,
    topLimit: 1,
  })

  const { data, isLoading, isError, refetch } = usePlatformWorkspaces({
    q: qApplied || undefined,
    page,
    size,
  })

  useDocumentTitle(t('workspaces.title'))

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
        case 'name':
          return compareValues(a.name, b.name, sortDir)
        case 'slug':
          return compareValues(a.slug, b.slug, sortDir)
        case 'owner':
          return compareValues(a.ownerEmail, b.ownerEmail, sortDir)
        case 'members':
          return compareValues(a.memberCount, b.memberCount, sortDir)
        case 'createdAt':
          return compareValues(a.createdAt, b.createdAt, sortDir)
        default:
          return 0
      }
    })
    return list
  }, [data?.content, sortKey, sortDir])

  const avgMembers = useMemo(() => {
    if (!data?.content.length) return null
    const sum = data.content.reduce((acc, w) => acc + (w.memberCount ?? 0), 0)
    return sum / data.content.length
  }, [data?.content])

  const totalWs = overview?.workspaces.total
  const newWeek = overview?.workspaces.newInRange
  const pageTotal = data?.totalElements

  return (
    <div className="platform-content">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('workspaces.title')}</h1>
      </div>

      {/* Stats row — design template */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('workspaces.stats.total')}
          value={
            overviewLoading
              ? '…'
              : totalWs != null
                ? formatNumber(totalWs, language)
                : pageTotal != null
                  ? formatNumber(pageTotal, language)
                  : '—'
          }
          hint={
            newWeek != null ? (
              <span className="font-medium platform-hint-success">
                +{formatNumber(newWeek, language)} {t('workspaces.stats.thisWeek')}
              </span>
            ) : null
          }
        />
        <StatCard
          label={t('workspaces.stats.listed')}
          value={pageTotal != null ? formatNumber(pageTotal, language) : '—'}
          hint={
            qApplied
              ? t('workspaces.stats.matchingSearch')
              : t('workspaces.stats.directoryTotal')
          }
        />
        <StatCard
          label={t('workspaces.stats.avgMembers')}
          value={
            avgMembers != null
              ? avgMembers.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', {
                  maximumFractionDigits: 1,
                })
              : '—'
          }
          hint={t('workspaces.stats.perWorkspacePage')}
        />
        <StatCard
          label={t('workspaces.stats.pageMembers')}
          value={
            data?.content.length
              ? formatNumber(
                  data.content.reduce((a, w) => a + (w.memberCount ?? 0), 0),
                  language,
                )
              : '—'
          }
          hint={t('workspaces.stats.onThisPage')}
        />
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('workspaces.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
          <div className="relative min-w-[200px] max-w-md flex-1">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              className="input w-full !pl-9 pr-8"
              placeholder={t('workspaces.search')}
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
                  label={t('workspaces.name')}
                  active={sortKey === 'name'}
                  dir={sortDir}
                  onSort={() => onSort('name')}
                />
                <SortableTh
                  label={t('workspaces.slug')}
                  active={sortKey === 'slug'}
                  dir={sortDir}
                  onSort={() => onSort('slug')}
                />
                <SortableTh
                  label={t('workspaces.owner')}
                  active={sortKey === 'owner'}
                  dir={sortDir}
                  onSort={() => onSort('owner')}
                />
                <SortableTh
                  label={t('workspaces.members')}
                  active={sortKey === 'members'}
                  dir={sortDir}
                  onSort={() => onSort('members')}
                  align="right"
                />
                <SortableTh
                  label={t('workspaces.createdAt')}
                  active={sortKey === 'createdAt'}
                  dir={sortDir}
                  onSort={() => onSort('createdAt')}
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
                    {t('workspaces.empty')}
                  </td>
                </tr>
              ) : (
                rows.map((w) => {
                  const grad = avatarGradient(w.slug || w.id)
                  return (
                    <tr
                      key={w.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(w)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelected(w)
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={t('workspaces.viewDetail', { name: w.name })}
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold platform-avatar-text shadow-sm ${grad}`}
                          >
                            {initialsFromName(w.name)}
                          </div>
                          <span className="font-medium">{w.name}</span>
                        </div>
                      </td>
                      <td className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                        {w.slug}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                          <IconUser size={12} className="shrink-0 opacity-60" />
                          <span className="truncate">{w.ownerEmail}</span>
                        </span>
                      </td>
                      <td className="text-right tabular-nums font-medium">{w.memberCount}</td>
                      <td className="col-hide-mobile text-[var(--color-text-secondary)]">
                        {formatDateTime(w.createdAt, language)}
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

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? t('workspaces.detailTitle')}
        description={t('workspaces.detailSubtitle')}
        size="lg"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold platform-avatar-text shadow-sm ${avatarGradient(selected.slug || selected.id)}`}
              >
                {initialsFromName(selected.name)}
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold">{selected.name}</div>
                <div className="font-mono text-sm text-[var(--color-text-tertiary)]">
                  {selected.slug}
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailField label={t('workspaces.detail.id')} value={selected.id} mono />
              <DetailField label={t('workspaces.slug')} value={selected.slug} mono />
              <DetailField label={t('workspaces.owner')} value={selected.ownerEmail} />
              <DetailField
                label={t('workspaces.detail.ownerId')}
                value={selected.ownerUserId}
                mono
              />
              <DetailField
                label={t('workspaces.members')}
                value={formatNumber(selected.memberCount, language)}
              />
              <DetailField
                label={t('workspaces.createdAt')}
                value={formatDateTime(selected.createdAt, language)}
              />
            </dl>

            <p className="rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">
              {t('workspaces.detail.privacy')}
            </p>

            <div className="flex justify-end pt-2">
              <Link
                to={`/w/${selected.id}`}
                className="btn-primary text-xs py-2 px-3.5 inline-flex items-center gap-1.5"
                onClick={() => setSelected(null)}
              >
                <span>{t('workspaces.goToWorkspace', { defaultValue: 'Vào workspace này' })}</span>
                <IconArrowRight size={14} />
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: ReactNode
}) {
  return (
    <div className="platform-card p-4">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint != null && hint !== '' && (
        <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{hint}</div>
      )}
    </div>
  )
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-all text-sm font-medium ${mono ? 'font-mono text-[12px]' : ''}`}
      >
        {value || '—'}
      </dd>
    </div>
  )
}
