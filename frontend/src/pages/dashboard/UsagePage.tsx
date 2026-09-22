import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconActivity,
  IconChevronRight,
  IconCoins,
  IconRefresh,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocuments } from '@/hooks/useDocuments'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useJobs } from '@/hooks/useJobs'
import { useProjects } from '@/hooks/useProjects'
import { useUsage } from '@/hooks/useUsage'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/** D.6 — PM/Admin AI Resource Usage sub-dashboard. */
export function UsagePage() {
  const { t } = useTranslation(['dashboard', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const [projectId, setProjectId] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [jobId, setJobId] = useState('')

  const { data: projects = [], isLoading: projectsLoading } = useProjects(workspaceId)
  const { data: documents = [], isLoading: documentsLoading } = useDocuments(
    workspaceId,
    projectId || undefined,
  )
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(
    workspaceId,
    documentId || undefined,
  )

  const query = useMemo(
    () => ({
      projectId: projectId || undefined,
      documentId: documentId || undefined,
      jobId: jobId || undefined,
    }),
    [projectId, documentId, jobId],
  )
  const { data, isLoading, isFetching, isError, error, refetch } = useUsage(
    workspaceId,
    query,
  )

  useDocumentTitle(t('dashboard:usage.title'))

  const cards = [
    {
      key: 'input',
      label: t('dashboard:usage.summary.input'),
      value: data?.totalInputTokens ?? 0,
    },
    {
      key: 'output',
      label: t('dashboard:usage.summary.output'),
      value: data?.totalOutputTokens ?? 0,
    },
    {
      key: 'total',
      label: t('dashboard:usage.summary.total'),
      value: data?.totalTokens ?? 0,
    },
    {
      key: 'calls',
      label: t('dashboard:usage.summary.operations'),
      value: data?.operationCount ?? 0,
    },
  ]

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <Link to={`/w/${workspaceId}`} className="btn-link">
          {t('common:nav.dashboard')}
        </Link>
        <IconChevronRight size={10} />
        <span>{t('dashboard:usage.title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard:usage.title')}</h1>
          <div className="page-subtitle">{t('dashboard:usage.subtitle')}</div>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <IconRefresh size={16} className={isFetching ? 'animate-spin' : undefined} />
          {t('dashboard:updatedAt')}
        </button>
      </div>

      <div className="app-card usage-filter-bar">
        <FilterSelect
          label={t('dashboard:usage.filter.project')}
          value={projectId}
          loading={projectsLoading}
          allLabel={t('dashboard:usage.filter.allProjects')}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          onChange={(value) => {
            setProjectId(value)
            setDocumentId('')
            setJobId('')
          }}
        />
        <FilterSelect
          label={t('dashboard:usage.filter.document')}
          value={documentId}
          loading={documentsLoading}
          disabled={!projectId}
          allLabel={t('dashboard:usage.filter.allDocuments')}
          options={documents.map((document) => ({
            value: document.id,
            label: document.name,
          }))}
          onChange={(value) => {
            setDocumentId(value)
            setJobId('')
          }}
        />
        <FilterSelect
          label={t('dashboard:usage.filter.job')}
          value={jobId}
          loading={jobsLoading}
          disabled={!documentId}
          allLabel={t('dashboard:usage.filter.allJobs')}
          options={jobs.map((job) => ({
            value: job.id,
            label: `${job.targetLang.toUpperCase()} · ${job.status}`,
          }))}
          onChange={setJobId}
        />
        <button
          type="button"
          className="btn-ghost usage-clear-filter"
          disabled={!projectId && !documentId && !jobId}
          onClick={() => {
            setProjectId('')
            setDocumentId('')
            setJobId('')
          }}
        >
          {t('dashboard:usage.filter.clear')}
        </button>
      </div>

      {isError && (
        <div className="app-card mt-4">
          <EmptyState
            icon={<IconActivity size={38} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-10"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
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
                <div className="stat-label">{card.label}</div>
                <div className="stat-value">
                  {isLoading ? '…' : formatCompactNumber(card.value, language)}
                </div>
                <div className="stat-sub">{t('dashboard:usage.summary.currentScope')}</div>
              </div>
            ))}
            <div className="app-card stat-card usage-cost-card">
              <div className="stat-label">{t('dashboard:usage.summary.cost')}</div>
              <div className="usage-cost-value">
                <IconCoins size={18} />
                {data?.cost || t('dashboard:widget.usage.comingSoon')}
              </div>
              <div className="stat-sub">Q-DASH1</div>
            </div>
          </div>

          <div className="usage-tables">
            <UsageTable
              title={t('dashboard:usage.byOperation.title')}
              subtitle={t('dashboard:usage.byOperation.subtitle')}
              loading={isLoading}
              empty={!data?.byOperation.length}
              emptyLabel={t('dashboard:usage.empty')}
              headers={[
                t('dashboard:usage.col.operation'),
                t('dashboard:usage.col.input'),
                t('dashboard:usage.col.output'),
                t('dashboard:usage.col.total'),
                t('dashboard:usage.col.calls'),
              ]}
              numericStartIndex={1}
              rows={(data?.byOperation ?? []).map((row) => [
                <span key="operation" className="operation-chip">{row.operation}</span>,
                formatNumber(row.inputTokens, language),
                formatNumber(row.outputTokens, language),
                formatNumber(row.totalTokens, language),
                formatNumber(row.operationCount, language),
              ])}
            />

            <UsageTable
              title={t('dashboard:usage.byModel.title')}
              subtitle={t('dashboard:usage.byModel.subtitle')}
              loading={isLoading}
              empty={!data?.byModel.length}
              emptyLabel={t('dashboard:usage.empty')}
              headers={[
                t('dashboard:usage.col.provider'),
                t('dashboard:usage.col.model'),
                t('dashboard:usage.col.input'),
                t('dashboard:usage.col.output'),
                t('dashboard:usage.col.total'),
                t('dashboard:usage.col.calls'),
              ]}
              numericStartIndex={2}
              rows={(data?.byModel ?? []).map((row) => [
                row.provider || '—',
                <span key="model" className="font-mono text-[12px]">{row.model || '—'}</span>,
                formatNumber(row.inputTokens, language),
                formatNumber(row.outputTokens, language),
                formatNumber(row.totalTokens, language),
                formatNumber(row.operationCount, language),
              ])}
            />
          </div>
        </>
      )}
    </div>
  )
}

type FilterSelectProps = {
  label: string
  value: string
  allLabel: string
  options: { value: string; label: string }[]
  loading?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  loading,
  disabled,
  onChange,
}: FilterSelectProps) {
  return (
    <label className="usage-filter-field">
      <span className="field-label">{label}</span>
      <select
        className="field-input"
        value={value}
        disabled={disabled || loading}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{loading ? '…' : allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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
        <table className="dd-table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={header} className={index >= numericStartIndex ? 'text-right' : undefined}>
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
                    <td key={cellIndex} className={cellIndex >= numericStartIndex ? 'num' : undefined}>
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
