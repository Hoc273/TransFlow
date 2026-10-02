import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconSearch } from '@tabler/icons-react'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformCreditMonitor } from '@/hooks/usePlatform'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import type { PlatformCreditMonitorSort } from '@/types/platform'

const SORTS: PlatformCreditMonitorSort[] = ['BALANCE', 'CREDITED_7D', 'USED_7D']

/**
 * Super Admin credit monitor: every account's balance and 7-day flow, with anomaly flags.
 * Flagged accounts are listed first so they cannot hide behind larger balances.
 */
export function PlatformCreditMonitorPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [sort, setSort] = useState<PlatformCreditMonitorSort>('BALANCE')
  const [page, setPage] = useState(0)

  useDocumentTitle(t('creditMonitor.title'))

  const { data, isLoading, isError, refetch } = usePlatformCreditMonitor({
    q: qApplied || undefined,
    flaggedOnly,
    sort,
    page,
    size: 20,
  })
  const accounts = data?.accounts
  const num = (value: number | null | undefined) =>
    value == null ? '—' : formatNumber(Number(value), language)

  return (
    <div className="platform-content">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('creditMonitor.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-secondary)]">
          {t('creditMonitor.subtitle')}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('creditMonitor.stats.totalBalance')} value={num(data?.totalBalance)} />
        <StatCard label={t('creditMonitor.stats.credited7d')} value={num(data?.credited7d)} />
        <StatCard label={t('creditMonitor.stats.used7d')} value={num(data?.used7d)} />
        <StatCard
          label={t('creditMonitor.stats.flagged')}
          value={data ? `${formatNumber(data.flaggedCount, language)} / ${formatNumber(data.accountCount, language)}` : '—'}
          danger={!!data?.flaggedCount}
        />
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('creditMonitor.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              className="input w-full !pl-9"
              placeholder={t('creditMonitor.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(0)
                  setQApplied(q.trim())
                }
              }}
            />
          </div>
          <select
            className="input py-2 text-xs"
            aria-label={t('creditMonitor.sortLabel')}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as PlatformCreditMonitorSort)
              setPage(0)
            }}
          >
            {SORTS.map((value) => (
              <option key={value} value={value}>
                {t(`creditMonitor.sort.${value}`)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => {
                setFlaggedOnly(e.target.checked)
                setPage(0)
              }}
            />
            {t('creditMonitor.flaggedOnly')}
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <th>{t('creditMonitor.columns.user')}</th>
                <th className="text-right">{t('creditMonitor.columns.balance')}</th>
                <th className="text-right">{t('creditMonitor.columns.credited7d')}</th>
                <th className="text-right">{t('creditMonitor.columns.used7d')}</th>
                <th className="col-hide-mobile">{t('creditMonitor.columns.lastActivity')}</th>
                <th>{t('creditMonitor.columns.flags')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !accounts?.content.length ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('creditMonitor.empty')}
                  </td>
                </tr>
              ) : (
                accounts.content.map((item) => (
                  <tr key={item.userId}>
                    <td>
                      <Link
                        to={`/platform/activity?${new URLSearchParams({ userId: item.userId, user: item.email ?? item.userId })}`}
                        className="block hover:underline"
                        title={t('creditMonitor.viewActivity')}
                      >
                        <div className="font-medium">{item.fullName ?? '—'}</div>
                        <div className="text-[12px] text-[var(--color-text-tertiary)]">{item.email ?? item.userId}</div>
                      </Link>
                    </td>
                    <td className="text-right font-semibold tabular-nums">{num(item.balance)}</td>
                    <td className="text-right tabular-nums">{num(item.credited7d)}</td>
                    <td className="text-right tabular-nums">{num(item.used7d)}</td>
                    <td className="col-hide-mobile text-[var(--color-text-secondary)]">
                      {item.lastActivityAt ? formatDateTime(item.lastActivityAt, language) : '—'}
                    </td>
                    <td>
                      {item.flags.length ? (
                        <div className="flex flex-col gap-1">
                          {item.flags.map((flag) => (
                            <span
                              key={flag}
                              className="platform-action-badge platform-action-danger inline-flex items-center gap-1"
                              title={t(`creditMonitor.flagHelp.${flag}`, {
                                ledger: num(item.ledgerBalance),
                                unverified: num(item.unverifiedCredit),
                              })}
                            >
                              <IconAlertTriangle size={12} />
                              {t(`creditMonitor.flag.${flag}`)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {accounts && (
          <div className="border-t border-[var(--color-border)] px-4 py-3">
            <PlatformPagination
              page={accounts.page}
              totalPages={accounts.totalPages}
              totalElements={accounts.totalElements}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, danger }: { label: string; value: ReactNode; danger?: boolean }) {
  return (
    <div className="platform-card p-4">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums tracking-tight ${danger ? 'text-[var(--color-error)]' : ''}`}>
        {value}
      </div>
    </div>
  )
}
