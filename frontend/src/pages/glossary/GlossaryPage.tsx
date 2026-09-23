import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconFileSpreadsheet,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useAddTerm,
  useDeleteTerm,
  useGlossaryTerms,
  useImportGlossaryCsv,
  useUpdateTerm,
} from '@/hooks/useGlossary'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/types/api'
import type { GlossaryTerm, ImportResult } from '@/types/glossary'

/** D.1 Glossary Management (Data-Dense) — sidebar + term table. */
export function GlossaryPage() {
  const { t } = useTranslation(['glossary', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const canEdit = usePermission('glossary.crud')
  useDocumentTitle(t('glossary:title'))

  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useProjects(workspaceId)

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const activeProjectId = selectedProjectId && projects.some((p) => p.id === selectedProjectId)
    ? selectedProjectId
    : projects[0]?.id ?? null

  const {
    data: terms = [],
    isLoading: termsLoading,
    isError: termsError,
    error: termsErr,
    refetch: refetchTerms,
  } = useGlossaryTerms(workspaceId, activeProjectId ?? undefined)

  const addTerm = useAddTerm(workspaceId, activeProjectId ?? undefined)
  const updateTerm = useUpdateTerm(workspaceId, activeProjectId ?? undefined)
  const deleteTerm = useDeleteTerm(workspaceId, activeProjectId ?? undefined)
  const importCsv = useImportGlossaryCsv(workspaceId, activeProjectId ?? undefined)

  const [addTermOpen, setAddTermOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [termSearchQuery, setTermSearchQuery] = useState('')
  const [savedTermId, setSavedTermId] = useState<string | null>(null)
  const [quickSource, setQuickSource] = useState('')
  const [quickTarget, setQuickTarget] = useState('')
  const quickSourceRef = useRef<HTMLInputElement>(null)

  const [termForm, setTermForm] = useState({
    sourceTerm: '',
    targetTerm: '',
    targetLang: 'all',
  })

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  )

  const onAddTerm = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const sourceTerm = termForm.sourceTerm.trim()
    const targetTerm = termForm.targetTerm.trim()
    if (!sourceTerm || !targetTerm) {
      setFormError(t('glossary:term.required'))
      return
    }
    const dup = terms.some(
      (x) =>
        x.sourceTerm.toLowerCase() === sourceTerm.toLowerCase() &&
        x.targetLang.toLowerCase() === termForm.targetLang.toLowerCase(),
    )
    if (dup) {
      setFormError(t('glossary:term.duplicate'))
      return
    }

    addTerm.mutate(
      {
        sourceTerm,
        targetTerm,
        targetLang: termForm.targetLang.trim() || 'all',
      },
      {
        onSuccess: () => {
          setAddTermOpen(false)
          setTermForm({
            sourceTerm: '',
            targetTerm: '',
            targetLang: 'all',
          })
        },
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  const onInlineTarget = (term: GlossaryTerm, newTarget: string) => {
    const trimmed = newTarget.trim()
    if (!trimmed || trimmed === term.targetTerm) return
    setRowError(null)
    updateTerm.mutate(
      {
        termId: term.id,
        body: {
          sourceTerm: term.sourceTerm,
          targetTerm: trimmed,
          targetLang: term.targetLang,
        },
      },
      {
        onSuccess: () => {
          setSavedTermId(term.id)
          setTimeout(() => setSavedTermId((prev) => (prev === term.id ? null : prev)), 1500)
        },
        onError: (err) => {
          setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  const onQuickAdd = (e?: FormEvent) => {
    if (e) e.preventDefault()
    const sourceTerm = quickSource.trim()
    const targetTerm = quickTarget.trim()
    if (!sourceTerm || !targetTerm) return

    addTerm.mutate(
      { sourceTerm, targetTerm, targetLang: 'all' },
      {
        onSuccess: () => {
          setQuickSource('')
          setQuickTarget('')
          quickSourceRef.current?.focus()
        },
        onError: (err) => {
          setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  const onExportCsv = () => {
    if (!terms.length) return
    const headers = ['source_term', 'target_term', 'target_lang']
    const rows = terms.map((t) => [
      `"${(t.sourceTerm || '').replace(/"/g, '""')}"`,
      `"${(t.targetTerm || '').replace(/"/g, '""')}"`,
      `"${(t.targetLang || '').replace(/"/g, '""')}"`,
    ])
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeProject?.name || 'glossary'}_terms.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const onDownloadTemplate = () => {
    const headers = ['source_term', 'target_term', 'target_lang']
    const sampleRows = [
      ['Artificial Intelligence', 'Trí tuệ nhân tạo', 'vi'],
      ['Machine Learning', 'Học máy', 'vi'],
      ['Deep Learning', 'Học sâu', 'all'],
      ['Database', 'Cơ sở dữ liệu', 'vi'],
    ]
    const csv =
      '\uFEFF' +
      [
        headers.join(','),
        ...sampleRows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')),
      ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'glossary_template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const filteredTerms = useMemo(() => {
    const q = termSearchQuery.trim().toLowerCase()
    if (!q) return terms
    return terms.filter(
      (t) =>
        t.sourceTerm.toLowerCase().includes(q) ||
        t.targetTerm.toLowerCase().includes(q) ||
        t.targetLang.toLowerCase().includes(q),
    )
  }, [terms, termSearchQuery])

  const onDeleteTerm = (term: GlossaryTerm) => {
    if (!window.confirm(t('glossary:term.confirmDelete', { term: term.sourceTerm }))) return
    setRowError(null)
    deleteTerm.mutate(term.id, {
      onError: (err) => {
        setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
      },
    })
  }

  const onImport = (file: File | null) => {
    if (!file) return
    setFormError(null)
    setImportResult(null)
    importCsv.mutate(file, {
      onSuccess: (result) => {
        setImportResult(result)
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : t('common:error.generic'))
      },
    })
  }

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('glossary:title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{t('glossary:title')}</h1>
        </div>
      </div>

      {isLoading && (
        <div className="app-card py-12 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common:loading')}
        </div>
      )}

      {isError && !isLoading && (
        <div className="app-card">
          <EmptyState
            icon={<IconBook2 size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        </div>
      )}

      {!isLoading && !isError && projects.length === 0 && (
        <div className="app-card">
          <EmptyState
            icon={<IconBook2 size={40} stroke={1.25} />}
            title={t('glossary:noProjectsTitle')}
            description={t('glossary:noProjectsDesc')}
            className="py-14"
          />
        </div>
      )}

      {!isLoading && !isError && projects.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* Project list */}
          <div className="app-card overflow-hidden p-0">
            <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase">
              {t('glossary:sidebar')}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-2.5 text-left text-sm transition ${
                      project.id === activeProjectId
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span className="font-medium">{project.name}</span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {t('glossary:sourceLang', { language: project.sourceLang })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Term table */}
          <div className="app-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {activeProject?.name}
                </div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">
                  {t('glossary:termCount', { count: terms.length })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search within terms */}
                {terms.length > 0 && (
                  <div className="relative w-40 sm:w-48">
                    <IconSearch
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                    />
                    <input
                      type="text"
                      value={termSearchQuery}
                      onChange={(e) => setTermSearchQuery(e.target.value)}
                      placeholder={t('glossary:term.searchPlaceholder')}
                      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] py-1 pl-7 pr-6 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-hidden"
                    />
                    {termSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setTermSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                      >
                        <IconX size={12} />
                      </button>
                    )}
                  </div>
                )}

                {/* Export CSV button */}
                {terms.length > 0 && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={onExportCsv}
                    title={t('glossary:export.button')}
                  >
                    <IconDownload size={14} />
                    <span className="col-hide-mobile">{t('glossary:export.button')}</span>
                  </button>
                )}

                {/* Download CSV Template */}
                {canEdit && activeProjectId && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={onDownloadTemplate}
                    title={t('glossary:template.button')}
                  >
                    <IconFileSpreadsheet size={14} />
                    <span className="col-hide-mobile">{t('glossary:template.button')}</span>
                  </button>
                )}

                {/* Import CSV */}
                {canEdit && activeProjectId && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setFormError(null)
                      setImportResult(null)
                      setImportOpen(true)
                    }}
                  >
                    <IconUpload size={14} />
                    <span className="col-hide-mobile">{t('glossary:import.button')}</span>
                  </button>
                )}

                {/* Detailed add term modal button */}
                {canEdit && activeProjectId && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => {
                      setFormError(null)
                      setAddTermOpen(true)
                    }}
                  >
                    <IconPlus size={14} />
                    <span className="col-hide-mobile">{t('glossary:term.add')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Inline Add Row */}
            {canEdit && activeProjectId && (
              <form
                onSubmit={onQuickAdd}
                className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/30 px-4 py-2 text-xs"
              >
                <div className="flex-1 min-w-[140px]">
                  <input
                    ref={quickSourceRef}
                    type="text"
                    value={quickSource}
                    onChange={(e) => setQuickSource(e.target.value)}
                    placeholder={t('glossary:term.sourcePlaceholder')}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-hidden"
                  />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <input
                    type="text"
                    value={quickTarget}
                    onChange={(e) => setQuickTarget(e.target.value)}
                    placeholder={t('glossary:term.targetPlaceholder')}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2.5 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-hidden"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!quickSource.trim() || !quickTarget.trim() || addTerm.isPending}
                  className="btn-primary btn-sm shrink-0 flex items-center gap-1 disabled:opacity-40 shadow-xs"
                >
                  <IconPlus size={13} />
                  <span>{t('glossary:term.quickAddEnter')}</span>
                </button>
              </form>
            )}

            {rowError && (
              <div className="mx-4 mt-3 rounded-lg border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error)]">
                {rowError}
              </div>
            )}

            {termsLoading && (
              <div className="py-10 text-center text-sm text-[var(--color-text-tertiary)]">
                {t('common:loading')}
              </div>
            )}

            {termsError && !termsLoading && (
              <EmptyState
                icon={<IconBook2 size={36} stroke={1.25} />}
                title={t('common:error.loadFailed')}
                description={termsErr instanceof ApiError ? termsErr.message : undefined}
                className="py-10"
              >
                <button
                  type="button"
                  className="btn-secondary mt-4"
                  onClick={() => void refetchTerms()}
                >
                  {t('common:retry')}
                </button>
              </EmptyState>
            )}

            {!termsLoading && !termsError && terms.length === 0 && (
              <EmptyState
                icon={<IconBook2 size={36} stroke={1.25} />}
                title={t('glossary:term.emptyTitle')}
                description={t('glossary:term.emptyDesc')}
                className="py-12"
              />
            )}

            {!termsLoading && !termsError && terms.length > 0 && filteredTerms.length === 0 && (
              <div className="py-10 text-center text-xs text-[var(--color-text-tertiary)]">
                {t('glossary:term.noMatch')}
              </div>
            )}

            {!termsLoading && !termsError && filteredTerms.length > 0 && (
              <div className="overflow-x-auto">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th className="w-2/5">{t('glossary:term.col.source')}</th>
                      <th className="w-2/5">{t('glossary:term.col.target')}</th>
                      <th className="col-hide-mobile">{t('glossary:term.col.targetLang')}</th>
                      {canEdit && <th style={{ width: 44 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTerms.map((term) => (
                      <tr key={term.id} className="hover:bg-[var(--color-bg-surface-2)]/40 transition">
                        <td>
                          <span className="font-semibold text-xs text-[var(--color-text-primary)]">
                            {term.sourceTerm}
                          </span>
                        </td>
                        <td>
                          <div className="relative flex items-center">
                            {canEdit ? (
                              <input
                                className="field-input py-1 text-xs pr-7 transition w-full"
                                defaultValue={term.targetTerm}
                                key={`${term.id}-${term.targetTerm}`}
                                onBlur={(e) => onInlineTarget(term, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    ;(e.target as HTMLInputElement).blur()
                                  }
                                }}
                              />
                            ) : (
                              <span className="text-xs text-[var(--color-text-primary)]">{term.targetTerm}</span>
                            )}
                            {savedTermId === term.id && (
                              <span className="absolute right-2 flex items-center gap-0.5 text-[11px] font-medium text-[#10b981] animate-in fade-in">
                                <IconCheck size={13} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="col-hide-mobile">
                          <span className="rounded bg-[var(--color-bg-surface-3)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-tertiary)]">
                            {term.targetLang}
                          </span>
                        </td>
                        {canEdit && (
                          <td className="text-right">
                            <button
                              type="button"
                              className="btn-icon-danger p-1"
                              onClick={() => onDeleteTerm(term)}
                              disabled={deleteTerm.isPending}
                              title={t('glossary:delete')}
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
          </div>
        </div>
      )}

      {/* Add term */}
      <Modal
        open={addTermOpen}
        onClose={() => !addTerm.isPending && setAddTermOpen(false)}
        title={t('glossary:term.addTitle')}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={addTerm.isPending}
              onClick={() => setAddTermOpen(false)}
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="submit"
              form="add-term-form"
              className="btn-primary"
              disabled={addTerm.isPending}
            >
              {addTerm.isPending ? t('glossary:term.adding') : t('glossary:term.add')}
            </button>
          </>
        }
      >
        <form id="add-term-form" onSubmit={onAddTerm} className="space-y-3">
          {formError && addTermOpen && (
            <div className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error)]">
              {formError}
            </div>
          )}
          <label className="field-label">
            <span>{t('glossary:term.col.source')}</span>
            <input
              className="field-input"
              value={termForm.sourceTerm}
              onChange={(e) => setTermForm((s) => ({ ...s, sourceTerm: e.target.value }))}
              required
              autoFocus
            />
          </label>
          <label className="field-label">
            <span>{t('glossary:term.col.target')}</span>
            <input
              className="field-input"
              value={termForm.targetTerm}
              onChange={(e) => setTermForm((s) => ({ ...s, targetTerm: e.target.value }))}
              required
            />
          </label>
          <label className="field-label">
            <span>{t('glossary:term.col.targetLang')}</span>
            <input
              className="field-input"
              value={termForm.targetLang}
              onChange={(e) => setTermForm((s) => ({ ...s, targetLang: e.target.value }))}
              placeholder="vi / en / all"
              required
            />
          </label>
        </form>
      </Modal>

      {/* Import CSV */}
      <Modal
        open={importOpen}
        onClose={() => !importCsv.isPending && setImportOpen(false)}
        title={t('glossary:import.title')}
        description={t('glossary:import.hint')}
        footer={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setImportOpen(false)}
            disabled={importCsv.isPending}
          >
            {t('common:actions.close')}
          </button>
        }
      >
        <div className="space-y-3">
          {formError && importOpen && <div className="field-error">{formError}</div>}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-2)] px-4 py-8 text-center">
            <IconUpload size={22} className="text-[var(--color-accent)]" />
            <span className="text-sm">{t('glossary:import.drop')}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={importCsv.isPending}
              onChange={(e) => onImport(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] px-1">
            <span>{t('glossary:import.hint')}</span>
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="inline-flex items-center gap-1 font-medium text-[var(--color-accent)] hover:underline cursor-pointer bg-transparent border-none p-0"
            >
              <IconFileSpreadsheet size={14} />
              <span>{t('glossary:template.download')}</span>
            </button>
          </div>
          {importCsv.isPending && (
            <div className="text-center text-sm text-[var(--color-text-tertiary)]">
              {t('glossary:import.importing')}
            </div>
          )}
          {importResult && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs">
              <div>
                {t('glossary:import.result', {
                  added: importResult.imported,
                  skipped: importResult.skipped,
                })}
              </div>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-[var(--color-error)]">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
