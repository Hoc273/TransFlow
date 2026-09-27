import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  IconAlertCircle,
  IconBook,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import {
  useAddTerm,
  useDeleteTerm,
  useGlossaryTerms,
  useImportGlossaryCsv,
  useUpdateTerm,
} from '@/hooks/useGlossary'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { ApiError } from '@/types/api'
import type { GlossaryTerm, ImportResult } from '@/types/glossary'
import { useTranslation } from 'react-i18next'

const EMPTY_TERMS: GlossaryTerm[] = []

export function MobileGlossaryPage() {
  const { t } = useTranslation(['mobile', 'glossary'])
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const canEdit = usePermission('glossary.crud')
  const projectsQuery = useProjects(workspaceId)
  const projects = projectsQuery.data ?? []
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const activeProjectId = selectedProjectId && projects.some((p) => p.id === selectedProjectId)
    ? selectedProjectId
    : projects[0]?.id
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const termsQuery = useGlossaryTerms(workspaceId, activeProjectId)
  const terms = termsQuery.data ?? EMPTY_TERMS
  const addTerm = useAddTerm(workspaceId, activeProjectId)
  const deleteTerm = useDeleteTerm(workspaceId, activeProjectId)
  const updateTerm = useUpdateTerm(workspaceId, activeProjectId)
  const importCsv = useImportGlossaryCsv(workspaceId, activeProjectId)

  const [search, setSearch] = useState('')
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [targetLang, setTargetLang] = useState('all')
  const [formError, setFormError] = useState<string | null>(null)
  const [editingTerm, setEditingTerm] = useState<GlossaryTerm | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const saving = addTerm.isPending || updateTerm.isPending

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return terms
    return terms.filter(
      (term) =>
        term.sourceTerm.toLowerCase().includes(query) ||
        term.targetTerm.toLowerCase().includes(query) ||
        term.targetLang.toLowerCase().includes(query),
    )
  }, [search, terms])

  const isLoading = projectsQuery.isLoading || Boolean(activeProjectId && termsQuery.isLoading)
  const error = projectsQuery.error ?? termsQuery.error

  const handleOpenAdd = () => {
    setEditingTerm(null)
    setSource('')
    setTarget('')
    setTargetLang('all')
    setFormError(null)
    setAddSheetOpen(true)
  }

  const handleAdd = (event: FormEvent) => {
    event.preventDefault()
    const sourceTerm = source.trim()
    const targetTerm = target.trim()
    const normalizedTargetLang = targetLang.trim()
    if (!sourceTerm || !targetTerm || !normalizedTargetLang) {
      setFormError(t('mobile:glossary.formRequired'))
      return
    }

    setFormError(null)
    const body = { sourceTerm, targetTerm, targetLang: normalizedTargetLang }
    const callbacks = {
      onSuccess: () => {
        setAddSheetOpen(false)
        setEditingTerm(null)
        setSource('')
        setTarget('')
        setTargetLang('all')
      },
      onError: (mutationError: Error) => {
        setFormError(
          mutationError instanceof ApiError ? mutationError.message : t('mobile:glossary.addFailed'),
        )
      },
    }
    if (editingTerm) {
      updateTerm.mutate({ termId: editingTerm.id, body }, callbacks)
    } else {
      addTerm.mutate(body, callbacks)
    }
  }

  const handleOpenEdit = (term: GlossaryTerm) => {
    setEditingTerm(term)
    setSource(term.sourceTerm)
    setTarget(term.targetTerm)
    setTargetLang(term.targetLang)
    setFormError(null)
    setAddSheetOpen(true)
  }

  const handleOpenImport = () => {
    setImportError(null)
    setImportResult(null)
    setImportOpen(true)
  }

  const handleImport = (file: File | null) => {
    if (!file) return
    setImportError(null)
    setImportResult(null)
    importCsv.mutate(file, {
      onSuccess: (result) => setImportResult(result),
      onError: (err) =>
        setImportError(err instanceof ApiError ? err.message : t('mobile:glossary.importFailed')),
    })
  }

  const handleRetry = () => {
    void projectsQuery.refetch()
    if (activeProjectId) void termsQuery.refetch()
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">
            {t('mobile:glossary.title')}
          </h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {activeProject ? `${activeProject.name} • ` : ''}
            {t('mobile:glossary.termCount', { count: terms.length })}
          </p>
        </div>
        {canEdit && activeProjectId && (
          <button
            type="button"
            onClick={handleOpenImport}
            aria-label={t('glossary:import.button')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-600 active:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            <IconUpload size={16} />
          </button>
        )}
        {canEdit && activeProjectId && (
          <button
            type="button"
            onClick={handleOpenAdd}
            aria-label={t('mobile:glossary.addShort')}
            className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
          >
            <IconPlus size={16} />
            <span>{t('mobile:glossary.addShort')}</span>
          </button>
        )}
      </div>

      {projects.length > 0 && (
        <select
          aria-label={t('mobile:glossary.selectProject')}
          value={activeProjectId ?? ''}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          className="h-10 w-full min-w-0 truncate rounded-xl border border-neutral-200 bg-neutral-50/50 p-2.5 text-xs font-medium text-neutral-900 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}

      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder={t('mobile:glossary.searchPlaceholder')}
      />

      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="py-6 text-center text-sm text-neutral-400">{t('mobile:glossary.loading')}</div>
          {[1, 2, 3].map((item) => (
            <MobileCard key={item} className="animate-pulse space-y-2 p-3">
              <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/3 rounded bg-neutral-100 dark:bg-neutral-800" />
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="mb-2 text-red-500" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            {t('mobile:glossary.loadFailed')}
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {error instanceof Error ? error.message : t('mobile:common.networkError')}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <IconRefresh size={14} />
            <span>{t('mobile:common.retry')}</span>
          </button>
        </MobileCard>
      ) : projects.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title={t('mobile:glossary.noProjectTitle')}
          description={t('mobile:glossary.noProjectDesc')}
        />
      ) : terms.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title={t('mobile:glossary.emptyTitle')}
          description={t('mobile:glossary.emptyDesc')}
          action={canEdit ? (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              {t('mobile:glossary.addTerm')}
            </button>
          ) : undefined}
        />
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title={t('mobile:glossary.noMatchTitle')}
          description={t('mobile:glossary.noMatchDesc')}
          action={
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-xl bg-neutral-100 px-4 py-2 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {t('mobile:common.clearSearch')}
            </button>
          }
        />
      ) : (
        <div className="min-w-0 space-y-2.5">
          {filtered.map((term) => (
            <MobileCard key={term.id} className="min-w-0 space-y-2 p-3.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-semibold text-neutral-900 dark:text-white">
                      {term.sourceTerm}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-neutral-400">→</span>
                    <span className="min-w-0 truncate text-sm font-semibold text-primary">
                      {term.targetTerm}
                    </span>
                  </div>
                  <span className="inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary dark:bg-primary/20">
                    {term.targetLang}
                  </span>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(term)}
                    aria-label={t('mobile:glossary.editTerm', { term: term.sourceTerm })}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-all hover:text-primary active:scale-95 active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <IconPencil size={16} />
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => deleteTerm.mutate(term.id)}
                    aria-label={t('mobile:glossary.deleteTerm', { term: term.sourceTerm })}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-all hover:text-red-500 active:scale-95 active:bg-red-50 dark:active:bg-red-950/30"
                  >
                    <IconTrash size={16} />
                  </button>
                )}
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      <BottomSheet
        isOpen={addSheetOpen}
        onClose={() => !saving && setAddSheetOpen(false)}
        title={editingTerm ? t('mobile:glossary.editTermTitle') : t('mobile:glossary.newTermTitle')}
      >
        <form onSubmit={handleAdd} className="space-y-3">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
              {formError}
            </div>
          )}
          <label className="block space-y-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <span>{t('mobile:glossary.sourceTerm')}</span>
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm font-normal focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <span>{t('mobile:glossary.targetTerm')}</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm font-normal focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <span>{t('mobile:glossary.targetLang')}</span>
            <input
              value={targetLang}
              onChange={(event) => setTargetLang(event.target.value)}
              placeholder="vi / en / ko / all"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm font-normal focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-xs transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? t('mobile:common.saving') : t('mobile:glossary.save')}
          </button>
        </form>
      </BottomSheet>

      <BottomSheet
        isOpen={importOpen}
        onClose={() => !importCsv.isPending && setImportOpen(false)}
        title={t('glossary:import.title')}
      >
        <div className="space-y-3">
          {importError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
              {importError}
            </div>
          )}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
            <IconUpload size={22} className="text-primary" />
            <span className="text-sm text-neutral-700 dark:text-neutral-300">{t('glossary:import.drop')}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="glossary-import-input"
              disabled={importCsv.isPending}
              onChange={(e) => {
                handleImport(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          <p className="text-[11px] text-neutral-500">{t('glossary:import.hint')}</p>
          {importCsv.isPending && (
            <p className="text-center text-sm text-neutral-400">{t('glossary:import.importing')}</p>
          )}
          {importResult && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
              <div>
                {t('glossary:import.result', {
                  added: importResult.imported,
                  skipped: importResult.skipped,
                })}
              </div>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-red-600 dark:text-red-400">
                  {importResult.errors.map((err, i) => (
                    <li key={i} className="break-words">{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}
