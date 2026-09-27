import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconActivity,
  IconArrowDownRight,
  IconArrowLeft,
  IconArrowUpRight,
  IconCoins,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useUsage } from '@/hooks/useUsage'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { assignUsageColors } from '@/lib/usageColors'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { OperationUsage } from '@/types/dashboard'

/** D.6 — PM/Admin AI Resource Usage sub-dashboard. */
export function UsagePage() {
  const { t } = useTranslation(['dashboard', 'common'])
  const { workspaceId = '' } = useParams()
  const language = useUiStore((s) => s.language)
  const { data, isLoading, isFetching, isError, error, refetch } = useUsage(
    workspaceId,
    { groupBy: 'operation' },
  )
  // The backend returns one grouping per call; project/user rows reuse the byOperation shape.
  const byProject = useUsage(workspaceId, { groupBy: 'project' })
  const byUser = useUsage(workspaceId, { groupBy: 'user' })

  useDocumentTitle(t('dashboard:usage.title'))

  const refreshing = isFetching || byProject.isFetching || byUser.isFetching
  const refreshAll = () => {
    void refetch()
    void byProject.refetch()
    void byUser.refetch()
  }

  const totalTokens = data?.totalTokens ?? 0
  const operations = [...(data?.byOperation ?? [])].sort((a, b) => b.totalTokens - a.totalTokens)
  const operationColors = assignUsageColors(operations.map((op) => op.operation))

  const cards = [
    {
      key: 'total',
      label: t('dashboard:usage.summary.total'),
      value: formatCompactNumber(totalTokens, language),
      icon: <IconSparkles size={16} />,
      tone: 'var(--color-accent)',
    },
    {
      key: 'input',
      label: t('dashboard:usage.summary.input'),
      value: formatCompactNumber(data?.totalInputTokens ?? 0, language),
      icon: <IconArrowDownRight size={16} />,
      tone: '#38bdf8',
    },
    {
      key: 'output',
      label: t('dashboard:usage.summary.output'),
      value: formatCompactNumber(data?.totalOutputTokens ?? 0, language),
      icon: <IconArrowUpRight size={16} />,
      tone: '#a855f7',
    },
    {
      key: 'calls',
      label: t('dashboard:usage.summary.operations'),
      value: formatNumber(data?.operationCount ?? 0, language),
      icon: <IconActivity size={16} />,
      tone: '#10b981',
    },
    {
      key: 'credit',
      label: t('dashboard:usage.summary.creditUsed'),
      value: formatNumber(data?.creditUsed ?? 0, language),
      icon: <IconCoins size={16} />,
      tone: '#f59e0b',
    },
  ]

  const groupHeaders = (first: string) => [
    first,
    t('dashboard:usage.col.input'),
    t('dashboard:usage.col.output'),
    t('dashboard:usage.col.total'),
    t('dashboard:usage.col.calls'),
    t('dashboard:usage.col.credit'),
  ]

  const groupRows = (rows: OperationUsage[] | undefined) =>
    [...(rows ?? [])]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((row) => [
        <span key="label" className="font-medium">{row.operation}</span>,
        formatNumber(row.inputTokens, language),
        formatNumber(row.outputTokens, language),
        formatNumber(row.totalTokens, language),
        formatNumber(row.operationCount, language),
        formatNumber(row.creditUsed ?? 0, language),
      ])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard:usage.title')}</h1>
          <div className="page-subtitle">{t('dashboard:usage.subtitle')}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/w/${workspaceId}`} className="btn-secondary">
            <IconArrowLeft size={16} />
            {t('dashboard:usage.backToDashboard')}
          </Link>
          <button
            type="button"
            className="btn-secondary"
            disabled={refreshing}
            onClick={refreshAll}
          >
            <IconRefresh size={16} className={refreshing ? 'animate-spin' : undefined} />
            {t('dashboard:updatedAt')}
          </button>
        </div>
      </div>

      {isError && (
        <div className="app-card mt-4">
          <EmptyState
            icon={<IconActivity size={38} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-10"
          >
            <button type="button" className="btn-secondary mt-4" onClick={refreshAll}>
              {t('common:retry')}
            </button>
          </EmptyState>
        </div>
      )}

      {!isError && (
        <>
          <div className="usage-summary-grid" aria-busy={isLoading || isFetching}>
            {cards.map((card) => (
              <div key={card.key} className="app-card stat-card">
                <div className="usage-stat-head">
                  <span className="usage-stat-icon" style={{ color: card.tone }}>
                    {card.icon}
                  </span>
                  <span className="stat-label mb-0">{card.label}</span>
                </div>
                <div className="stat-value">{isLoading ? '…' : card.value}</div>
              </div>
            ))}
          </div>

          <div className="usage-tables">
            <UsageTable
              title={t('dashboard:usage.byOperation.title')}
              subtitle={t('dashboard:usage.byOperation.subtitle')}
              loading={isLoading}
              empty={!operations.length}
              emptyLabel={t('dashboard:usage.empty')}
              headers={[
                t('dashboard:usage.col.operation'),
                t('dashboard:usage.col.share'),
                ...groupHeaders('').slice(1),
              ]}
              numericStartIndex={2}
              rows={operations.map((row) => {
                const color = operationColors.get(row.operation) ?? '#818cf8'
                const share = totalTokens > 0 ? (row.totalTokens / totalTokens) * 100 : 0
                return [
                  <span
                    key="operation"
                    className="operation-chip"
                    style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
                  >
                    <span className="operation-dot" style={{ background: color }} />
                    {row.operation}
                  </span>,
                  <div key="share" className="usage-share">
                    <div className="usage-share-track">
                      <div
                        className="usage-share-fill"
                        style={{ width: `${share}%`, background: color }}
                      />
                    </div>
                    <span className="usage-share-value">{share.toFixed(1)}%</span>
                  </div>,
                  formatNumber(row.inputTokens, language),
                  formatNumber(row.outputTokens, language),
                  formatNumber(row.totalTokens, language),
                  formatNumber(row.operationCount, language),
                  formatNumber(row.creditUsed ?? 0, language),
                ]
              })}
            />

            <div className="usage-tables-split">
              <UsageTable
                title={t('dashboard:usage.byProject.title')}
                subtitle={t('dashboard:usage.byProject.subtitle')}
                loading={byProject.isLoading}
                empty={!byProject.data?.byOperation.length}
                emptyLabel={
                  byProject.isError ? t('common:error.loadFailed') : t('dashboard:usage.empty')
                }
                headers={groupHeaders(t('dashboard:usage.col.project'))}
                numericStartIndex={1}
                rows={groupRows(byProject.data?.byOperation)}
              />

              <UsageTable
                title={t('dashboard:usage.byUser.title')}
                subtitle={t('dashboard:usage.byUser.subtitle')}
                loading={byUser.isLoading}
                empty={!byUser.data?.byOperation.length}
                emptyLabel={
                  byUser.isError ? t('common:error.loadFailed') : t('dashboard:usage.empty')
                }
                headers={groupHeaders(t('dashboard:usage.col.user'))}
                numericStartIndex={1}
                rows={groupRows(byUser.data?.byOperation)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

type UsageTableProps = {
  title: string
  subtitle: string
  loading: boolean
  empty: boolean
  emptyLabel: string
  headers: string[]
  rows: (string | ReactNode)[][]
  numericStartIndex: number
}

function UsageTable({
  title,
  subtitle,
  loading,
  empty,
  emptyLabel,
  headers,
  rows,
  numericStartIndex,
}: UsageTableProps) {
  return (
    <section className="app-card overflow-hidden">
      <div className="usage-table-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="dd-table usage-table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th
                  key={`${index}-${header}`}
                  className={index >= numericStartIndex ? 'usage-num' : undefined}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={headers.length} className="text-center text-[var(--color-text-tertiary)]">
                  …
                </td>
              </tr>
            ) : empty ? (
              <tr>
                <td colSpan={headers.length} className="text-center text-[var(--color-text-tertiary)]">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={cellIndex >= numericStartIndex ? 'num usage-num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
