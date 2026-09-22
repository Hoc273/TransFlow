import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconDownload,
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
  useAddTerms,
  useCreateGlossary,
  useDeleteGlossary,
  useDeleteTerm,
  useGlossaries,
  useGlossaryTerms,
  useImportGlossaryCsv,
  useUpdateTerm,
} from '@/hooks/useGlossary'
import { usePermission } from '@/hooks/usePermission'
import { formatDateTime } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { GlossaryTerm, ImportResult } from '@/types/glossary'

/** D.1 Glossary Management (Data-Dense) — sidebar + term table. */
export function GlossaryPage() {
  const { t } = useTranslation(['glossary', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const canEdit = usePermission('glossary.crud')
  useDocumentTitle(t('glossary:title'))

  const {
    data: glossaries = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useGlossaries(workspaceId)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeId = selectedId && glossaries.some((g) => g.id === selectedId)
    ? selectedId
    : glossaries[0]?.id ?? null

  useEffect(() => {
    if (!selectedId && glossaries[0]?.id) {
      setSelectedId(glossaries[0].id)
    }
  }, [glossaries, selectedId])

  const {
    data: terms = [],
    isLoading: termsLoading,
    isError: termsError,
    error: termsErr,
    refetch: refetchTerms,
  } = useGlossaryTerms(workspaceId, activeId ?? undefined)

  const createGlossary = useCreateGlossary(workspaceId)
  const deleteGlossary = useDeleteGlossary(workspaceId)
  const addTerms = useAddTerms(workspaceId, activeId ?? undefined)
  const updateTerm = useUpdateTerm(workspaceId, activeId ?? undefined)
  const deleteTerm = useDeleteTerm(workspaceId, activeId ?? undefined)
  const importCsv = useImportGlossaryCsv(workspaceId, activeId ?? undefined)

  const [createOpen, setCreateOpen] = useState(false)
  const [addTermOpen, setAddTermOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
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
    partOfSpeech: '',
    note: '',
    caseSensitive: false,
  })

  const activeGlossary = useMemo(
    () => glossaries.find((g) => g.id === activeId) ?? null,
    [glossaries, activeId],
  )

  const onCreateGlossary = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const name = newName.trim()
    if (!name) {
      setFormError(t('glossary:create.nameRequired'))
      return
    }
    createGlossary.mutate(
      { name, description: newDesc.trim() || undefined },
      {
        onSuccess: (g) => {
          setCreateOpen(false)
          setNewName('')
          setNewDesc('')
          setSelectedId(g.id)
        },
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  const onDeleteGlossary = () => {
    if (!activeId || !activeGlossary) return
    if (!window.confirm(t('glossary:confirmDelete', { name: activeGlossary.name }))) return
    deleteGlossary.mutate(activeId, {
      onSuccess: () => setSelectedId(null),
      onError: (err) => {
        setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
      },
    })
  }

  const onAddTerm = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const sourceTerm = termForm.sourceTerm.trim()
    const targetTerm = termForm.targetTerm.trim()
    if (!sourceTerm || !targetTerm) {
      setFormError(t('glossary:term.required'))
      return
    }
    // Client-side duplicate check (Q-G5)
    const pos = termForm.partOfSpeech.trim() || null
    const dup = terms.some(
      (x) =>
        x.sourceTerm.toLowerCase() === sourceTerm.toLowerCase() &&
        (x.partOfSpeech || null) === pos,
    )
    if (dup) {
      setFormError(t('glossary:term.duplicate'))
      return
    }

    addTerms.mutate(
      [
        {
          sourceTerm,
          targetTerm,
          caseSensitive: termForm.caseSensitive,
          partOfSpeech: termForm.partOfSpeech.trim() || undefined,
          note: termForm.note.trim() || undefined,
        },
      ],
      {
        onSuccess: (result) => {
          if (result.skipped > 0 || result.errors.length > 0) {
            setFormError(
              [
                result.skipped > 0 ? t('glossary:term.skipped', { n: result.skipped }) : null,
                ...result.errors,
              ]
                .filter(Boolean)
                .join(' · '),
            )
            if (result.added > 0) {
              setTermForm({
                sourceTerm: '',
                targetTerm: '',
                partOfSpeech: '',
                note: '',
                caseSensitive: false,
              })
            }
            return
          }
          setAddTermOpen(false)
          setTermForm({
            sourceTerm: '',
            targetTerm: '',
            partOfSpeech: '',
            note: '',
            caseSensitive: false,
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
          caseSensitive: term.caseSensitive,
          partOfSpeech: term.partOfSpeech ?? undefined,
          note: term.note ?? undefined,
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

    addTerms.mutate(
      [{ sourceTerm, targetTerm }],
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
    const headers = ['source_term', 'target_term', 'part_of_speech', 'case_sensitive', 'note']
    const rows = terms.map((t) => [
      `"${(t.sourceTerm || '').replace(/"/g, '""')}"`,
      `"${(t.targetTerm || '').replace(/"/g, '""')}"`,
      `"${(t.partOfSpeech || '').replace(/"/g, '""')}"`,
      t.caseSensitive ? 'TRUE' : 'FALSE',
      `"${(t.note || '').replace(/"/g, '""')}"`,
    ])
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeGlossary?.name || 'glossary'}_terms.csv`
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
        (t.partOfSpeech && t.partOfSpeech.toLowerCase().includes(q)) ||
        (t.note && t.note.toLowerCase().includes(q)),
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
          <div className="page-subtitle">{t('glossary:subtitle')}</div>
        </div>
        {canEdit && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <IconPlus size={16} />
            {t('glossary:create.button')}
          </button>
        )}
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

      {!isLoading && !isError && glossaries.length === 0 && (
        <div className="app-card">
          <EmptyState
            icon={<IconBook2 size={40} stroke={1.25} />}
            title={t('glossary:emptyTitle')}
            description={t('glossary:emptyDesc')}
            className="py-14"
          >
            {canEdit && (
              <button type="button" className="btn-primary mt-4" onClick={() => setCreateOpen(true)}>
                <IconPlus size={16} />
                {t('glossary:create.button')}
              </button>
            )}
          </EmptyState>
        </div>
      )}

      {!isLoading && !isError && glossaries.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* Sidebar list */}
          <div className="app-card overflow-hidden p-0">
            <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase">
              {t('glossary:sidebar')}
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {glossaries.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 border-l-2 px-3 py-2.5 text-left text-sm transition ${
                      g.id === activeId
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                        : 'border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
                    }`}
                    onClick={() => setSelectedId(g.id)}
                  >
                    <span className="font-medium">{g.name}</span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {t('glossary:termCount', { count: g.termCount })}
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
                  {activeGlossary?.name}
                </div>
                {activeGlossary?.description && (
                  <div className="text-[12px] text-[var(--color-text-tertiary)]">
                    {activeGlossary.description}
                  </div>
                )}
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

                {/* Import CSV */}
                {canEdit && activeId && (
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
                {canEdit && activeId && (
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

                {/* Delete glossary */}
                {canEdit && activeId && (
                  <button
                    type="button"
                    className="btn-icon-danger"
                    title={t('glossary:delete')}
                    onClick={onDeleteGlossary}
                    disabled={deleteGlossary.isPending}
                  >
                    <IconTrash size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Quick Inline Add Row */}
            {canEdit && activeId && (
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
                  disabled={!quickSource.trim() || !quickTarget.trim() || addTerms.isPending}
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
              >
                {canEdit && (
                  <button
                    type="button"
                    className="btn-primary mt-4"
                    onClick={() => setAddTermOpen(true)}
                  >
                    <IconPlus size={16} />
                    {t('glossary:term.add')}
                  </button>
                )}
              </EmptyState>
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
                      <th className="col-hide-mobile">{t('glossary:term.col.case')}</th>
                      <th className="col-hide-tablet">{t('glossary:term.col.updated')}</th>
                      {canEdit && <th style={{ width: 44 }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTerms.map((term) => (
                      <tr key={term.id} className="hover:bg-[var(--color-bg-surface-2)]/40 transition">
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-[var(--color-text-primary)]">
                              {term.sourceTerm}
                            </span>
                            {term.partOfSpeech && (
                              <span className="rounded bg-[var(--color-bg-surface-3)] px-1.5 py-0.2 text-[10px] font-mono text-[var(--color-text-tertiary)]">
                                {term.partOfSpeech}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="relative flex items-center">
                            {canEdit ? (
                              <input
                                className="field-input py-1 text-xs pr-7 transition w-full"
                                defaultValue={term.targetTerm}
                                key={`${term.id}-${term.updatedAt}`}
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
                          <div className="flex items-center gap-1.5">
                            {term.caseSensitive ? (
                              <span
                                className="rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-mono font-bold text-[var(--color-accent)]"
                                title={t('glossary:term.caseOn')}
                              >
                                Aa
                              </span>
                            ) : null}
                            {term.note ? (
                              <span
                                className="text-[11px] text-[var(--color-text-tertiary)] italic truncate max-w-[180px]"
                                title={term.note}
                              >
                                {term.note}
                              </span>
                            ) : (
                              !term.caseSensitive && <span className="text-[var(--color-text-tertiary)] text-xs">—</span>
                            )}
                          </div>
                        </td>
                        <td className="text-[11px] text-[var(--color-text-tertiary)] col-hide-tablet">
                          {term.updatedAt ? formatDateTime(term.updatedAt, language) : '—'}
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

      {/* Create glossary */}
      <Modal
        open={createOpen}
        onClose={() => !createGlossary.isPending && setCreateOpen(false)}
        title={t('glossary:create.title')}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={createGlossary.isPending}
              onClick={() => setCreateOpen(false)}
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="submit"
              form="create-glossary-form"
              className="btn-primary"
              disabled={createGlossary.isPending}
            >
              {createGlossary.isPending
                ? t('glossary:create.submitting')
                : t('glossary:create.submit')}
            </button>
          </>
        }
      >
        <form id="create-glossary-form" onSubmit={onCreateGlossary} className="space-y-3">
          {formError && createOpen && <div className="field-error">{formError}</div>}
          <label className="field-label">
            <span>{t('glossary:create.name')}</span>
            <input
              className="field-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              required
              maxLength={200}
            />
          </label>
          <label className="field-label">
            <span>{t('glossary:create.description')}</span>
            <textarea
              className="field-input min-h-[80px]"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              maxLength={2000}
            />
          </label>
        </form>
      </Modal>

      {/* Add term */}
      <Modal
        open={addTermOpen}
        onClose={() => !addTerms.isPending && setAddTermOpen(false)}
        title={t('glossary:term.addTitle')}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={addTerms.isPending}
              onClick={() => setAddTermOpen(false)}
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="submit"
              form="add-term-form"
              className="btn-primary"
              disabled={addTerms.isPending}
            >
              {addTerms.isPending ? t('glossary:term.adding') : t('glossary:term.add')}
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
            <span>{t('glossary:term.col.pos')}</span>
            <input
              className="field-input"
              value={termForm.partOfSpeech}
              onChange={(e) => setTermForm((s) => ({ ...s, partOfSpeech: e.target.value }))}
              placeholder="noun / verb / …"
            />
          </label>
          <label className="field-label">
            <span>{t('glossary:term.note')}</span>
            <input
              className="field-input"
              value={termForm.note}
              onChange={(e) => setTermForm((s) => ({ ...s, note: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={termForm.caseSensitive}
              onChange={(e) => setTermForm((s) => ({ ...s, caseSensitive: e.target.checked }))}
            />
            {t('glossary:term.caseSensitive')}
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
          {importCsv.isPending && (
            <div className="text-center text-sm text-[var(--color-text-tertiary)]">
              {t('glossary:import.importing')}
            </div>
          )}
          {importResult && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs">
              <div>
                {t('glossary:import.result', {
                  added: importResult.added,
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
