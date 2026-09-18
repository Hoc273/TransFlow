import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconChevronRight, IconDatabase, IconSearch, IconTrash } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { useDeleteTmEntry, useTmQuery } from '@/hooks/useTm'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import { formatDateTime } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { TmQueryParams } from '@/types/tm'

function matchBadgeClass(score: number, exact: boolean): string {
  if (exact || score >= 1) return 'tm-badge-exact'
  if (score >= 0.75) return 'tm-badge-fuzzy'
  return 'tm-badge-miss'
}

/** D.2 TM Management (Data-Dense) — search + table + delete. */
export function TmPage() {
  const { t } = useTranslation(['tm', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const canDelete = usePermission('tm.crud')
  useDocumentTitle(t('tm:title'))

  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('vi')
  const [sourceInput, setSourceInput] = useState('')
  const [debouncedSource, setDebouncedSource] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSource(sourceInput), 300)
    return () => window.clearTimeout(id)
  }, [sourceInput])

  const queryParams: TmQueryParams | null = useMemo(() => {
    if (!submitted || !sourceLang || !targetLang) return null
    return {
      sl: sourceLang,
      tl: targetLang,
      source: debouncedSource.trim() || undefined,
    }
  }, [submitted, sourceLang, targetLang, debouncedSource])

  const { data, isLoading, isError, error, refetch, isFetching } = useTmQuery(
    workspaceId,
    queryParams,
  )
  const deleteEntry = useDeleteTmEntry(workspaceId)

  const entries = data?.entries ?? []
  const lookup = data?.lookup

  const onSearch = () => {
    if (sourceLang === targetLang) {
      setRowError(t('tm:sameLang'))
      return
    }
    setRowError(null)
    setSubmitted(true)
  }

  const onDelete = (id: string, preview: string) => {
    if (!window.confirm(t('tm:confirmDelete', { preview: preview.slice(0, 80) }))) return
    setRowError(null)
    deleteEntry.mutate(id, {
      onError: (err) => {
        setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
      },
    })
  }

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('tm:title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{t('tm:title')}</h1>
          <div className="page-subtitle">{t('tm:subtitle')}</div>
        </div>
      </div>

      <div className="app-card mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field-label">
            <span>{t('tm:sourceLang')}</span>
            <select
              className="field-select"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {formatLanguageOption(l, language)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>{t('tm:targetLang')}</span>
            <select
              className="field-select"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {formatLanguageOption(l, language)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label sm:col-span-2">
            <span>{t('tm:sourceQuery')}</span>
            <div className="flex gap-2">
              <input
                className="field-input flex-1"
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                placeholder={t('tm:sourcePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSearch()
                }}
              />
              <button type="button" className="btn-primary" onClick={onSearch}>
                <IconSearch size={16} />
                {t('tm:search')}
              </button>
            </div>
          </label>
        </div>
        {rowError && <div className="field-error mt-3">{rowError}</div>}
      </div>

      {!submitted && (
        <div className="app-card">
          <EmptyState
            icon={<IconDatabase size={40} stroke={1.25} />}
            title={t('tm:idleTitle')}
            description={t('tm:idleDesc')}
            className="py-14"
          />
        </div>
      )}

      {submitted && (
        <div className="app-card overflow-hidden" aria-busy={isLoading || isFetching}>
          {isLoading && (
            <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
              {t('common:loading')}
            </div>
          )}

          {isError && !isLoading && (
            <EmptyState
              icon={<IconDatabase size={40} stroke={1.25} />}
              title={t('common:error.loadFailed')}
              description={error instanceof ApiError ? error.message : undefined}
              className="py-12"
            >
              <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
                {t('common:retry')}
              </button>
            </EmptyState>
          )}

          {!isLoading && !isError && (
            <>
              {lookup && (lookup.exact || lookup.fuzzy.length > 0) && (
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase">
                    {t('tm:lookupTitle')}
                  </div>
                  {lookup.exact && (
                    <div className="mb-2 rounded-lg border border-[var(--color-tm-exact)]/30 bg-[var(--color-tm-exact-bg)] px-3 py-2 text-sm">
                      <span className={`tm-badge ${matchBadgeClass(1, true)}`}>
                        {t('tm:exact')}
                      </span>
                      <div className="mt-1 text-[var(--color-text-primary)]">
                        {lookup.exact.sourceText}
                      </div>
                      <div className="text-[var(--color-text-secondary)]">
                        → {lookup.exact.targetText}
                      </div>
                    </div>
                  )}
                  {lookup.fuzzy.map((m, i) => (
                    <div
                      key={i}
                      className="mb-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                    >
                      <span className={`tm-badge ${matchBadgeClass(m.score, m.exact)}`}>
                        {Math.round(m.score * 100)}%
                      </span>
                      <div className="mt-1">{m.sourceText}</div>
                      <div className="text-[var(--color-text-secondary)]">→ {m.targetText}</div>
                    </div>
                  ))}
                </div>
              )}

              {entries.length === 0 ? (
                <EmptyState
                  icon={<IconDatabase size={40} stroke={1.25} />}
                  title={t('tm:emptyTitle')}
                  description={t('tm:emptyDesc')}
                  className="py-12"
                />
              ) : (
                <div className="overflow-x-auto">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">
                    <span>{t('tm:resultCount', { count: data?.total ?? entries.length })}</span>
                    {isFetching && <span>{t('tm:updating')}</span>}
                  </div>
                  <table className="dd-table">
                    <thead>
                      <tr>
                        <th>{t('tm:col.source')}</th>
                        <th>{t('tm:col.target')}</th>
                        <th className="col-hide-tablet">{t('tm:col.origin')}</th>
                        <th className="col-hide-tablet">{t('tm:col.domain')}</th>
                        <th className="col-hide-mobile">{t('tm:col.quality')}</th>
                        <th className="col-hide-mobile">{t('tm:col.updated')}</th>
                        {canDelete && <th style={{ width: 56 }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td className="max-w-[240px]">
                            <div className="line-clamp-2 text-[13px]">{e.sourceText}</div>
                          </td>
                          <td className="max-w-[240px]">
                            <div className="line-clamp-2 text-[13px] text-[var(--color-text-secondary)]">
                              {e.targetText}
                            </div>
                          </td>
                          <td className="col-hide-tablet">
                            <span className="phase-badge">{e.origin}</span>
                          </td>
                          <td className="text-[var(--color-text-secondary)] col-hide-tablet">
                            {e.domain || '—'}
                          </td>
                          <td className="font-mono text-[12px] col-hide-mobile">
                            {e.quality != null ? e.quality.toFixed(2) : '—'}
                          </td>
                          <td className="text-[12px] text-[var(--color-text-tertiary)] col-hide-mobile">
                            {e.updatedAt ? formatDateTime(e.updatedAt, language) : '—'}
                          </td>
                          {canDelete && (
                            <td>
                              <button
                                type="button"
                                className="btn-icon-danger"
                                title={t('tm:delete')}
                                disabled={deleteEntry.isPending}
                                onClick={() => onDelete(e.id, e.sourceText)}
                              >
                                <IconTrash size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
