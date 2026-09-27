import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconChevronDown, IconFile, IconTrash, IconUpload } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { useCreateBatch } from '@/hooks/useBatches'
import { useProjects } from '@/hooks/useProjects'
import { formatNumber } from '@/lib/format'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

const MAX_FILES = 20
const MAX_BYTES = 50 * 1024 * 1024
const ACCEPT = '.txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type CreateBatchModalProps = {
  open: boolean
  onClose: () => void
  workspaceId: string
  /** Pre-select project when opened from project context. */
  defaultProjectId?: string
}

function formatBytes(n: number, language: string): string {
  if (n < 1024) return `${formatNumber(n, language)} B`
  if (n < 1024 * 1024) return `${formatNumber(Math.round((n / 1024) * 10) / 10, language)} KB`
  return `${formatNumber(Math.round((n / (1024 * 1024)) * 10) / 10, language)} MB`
}

/** C.3 Create Batch — multipart POST /workspaces/{ws}/batches */
export function CreateBatchModal({
  open,
  onClose,
  workspaceId,
  defaultProjectId,
}: CreateBatchModalProps) {
  const { t } = useTranslation(['batch', 'common'])
  const navigate = useNavigate()
  const language = useUiStore((s) => s.language)
  const { data: projects = [], isLoading: projectsLoading } = useProjects(workspaceId)
  const createBatch = useCreateBatch(workspaceId)

  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [name, setName] = useState('')
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLangs, setTargetLangs] = useState<string[]>(['vi'])
  const [targetMenuOpen, setTargetMenuOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const targetMenuId = useId()
  const targetMenuRef = useRef<HTMLDivElement>(null)

  // Prefill project when opened from Document List (C.2).
  useEffect(() => {
    if (!open) return
    if (defaultProjectId) setProjectId(defaultProjectId)
    const p = projects.find((x) => x.id === (defaultProjectId || projectId))
    if (p?.sourceLang) {
      setSourceLang(p.sourceLang)
      setTargetLangs((current) => current.filter((lang) => lang !== p.sourceLang))
    }
  }, [open, defaultProjectId, projects, projectId])

  useEffect(() => {
    if (!targetMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (targetMenuRef.current && !targetMenuRef.current.contains(event.target as Node)) {
        setTargetMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [targetMenuOpen])

  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files])
  const overFileLimit = files.length > MAX_FILES
  const overSizeLimit = totalBytes > MAX_BYTES
  const canSubmit =
    !!projectId &&
    !!sourceLang &&
    targetLangs.length > 0 &&
    files.length > 0 &&
    !overFileLimit &&
    !overSizeLimit &&
    !createBatch.isPending

  const reset = () => {
    setProjectId(defaultProjectId ?? '')
    setName('')
    setSourceLang('en')
    setTargetLangs(['vi'])
    setTargetMenuOpen(false)
    setFiles([])
    setError(null)
  }

  const handleClose = () => {
    if (createBatch.isPending) return
    reset()
    onClose()
  }

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return
    setError(null)
    const next = [...files]
    for (const f of Array.from(list)) {
      const ext = f.name.toLowerCase()
      if (!ext.endsWith('.txt') && !ext.endsWith('.docx')) {
        setError(t('batch:create.invalidType', { name: f.name }))
        continue
      }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue
      next.push(f)
    }
    setFiles(next)
  }

  const toggleTarget = (lang: string) => {
    setTargetLangs((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    )
  }

  const changeSourceLang = (lang: string) => {
    setSourceLang(lang)
    setTargetLangs((current) => current.filter((target) => target !== lang))
  }

  const targetSummary =
    targetLangs.length === 0
      ? t('batch:create.targetPlaceholder')
      : targetLangs
          .slice(0, 2)
          .map((lang) => formatLanguageOption(lang, language))
          .join(', ')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!canSubmit) return
    if (targetLangs.includes(sourceLang)) {
      setError(t('batch:create.targetEqualsSource'))
      return
    }
    createBatch.mutate(
      {
        projectId,
        sourceLang,
        targetLangs,
        name: name.trim() || undefined,
        files,
      },
      {
        onSuccess: (res) => {
          reset()
          onClose()
          navigate(`/w/${workspaceId}/batches/${res.id || (res as any).batchId}`)
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
            setError(t('batch:create.rateLimited'))
            return
          }
          setError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('batch:create.title')}
      description={t('batch:create.subtitle')}
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            disabled={createBatch.isPending}
            onClick={handleClose}
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="submit"
            form="create-batch-form"
            className="btn-primary"
            disabled={!canSubmit}
          >
            {createBatch.isPending ? t('batch:create.submitting') : t('batch:create.submit')}
          </button>
        </>
      }
    >
      <form id="create-batch-form" onSubmit={onSubmit} className="space-y-4">
        <label className="field-label">
          <span>{t('batch:create.project')}</span>
          <select
            className="field-input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
            disabled={projectsLoading}
          >
            <option value="">{t('batch:create.projectPlaceholder')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} - {formatLanguageOption(p.sourceLang, language)}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          <span>{t('batch:create.nameOptional')}</span>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('batch:create.namePlaceholder')}
            maxLength={200}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            <span>{t('batch:create.sourceLang')}</span>
            <select
              className="field-input"
              value={sourceLang}
              onChange={(e) => changeSourceLang(e.target.value)}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {formatLanguageOption(l, language)}
                </option>
              ))}
            </select>
          </label>
          <div className="field-label">
            <span>{t('batch:create.targetLangs')}</span>
            <div
              ref={targetMenuRef}
              className="language-multiselect"
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setTargetMenuOpen(false)
              }}
            >
              <button
                type="button"
                className="language-multiselect-trigger"
                aria-expanded={targetMenuOpen}
                aria-controls={targetMenuId}
                aria-haspopup="true"
                onClick={() => setTargetMenuOpen((current) => !current)}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {targetSummary}
                  {targetLangs.length > 2 && ` +${targetLangs.length - 2}`}
                </span>
                {targetLangs.length > 0 && (
                  <span className="language-multiselect-count">{targetLangs.length}</span>
                )}
                <IconChevronDown
                  size={15}
                  className={targetMenuOpen ? 'rotate-180' : ''}
                  aria-hidden
                />
              </button>
              {targetMenuOpen && (
                <div
                  id={targetMenuId}
                  className="language-multiselect-menu"
                  role="group"
                  aria-label={t('batch:create.targetLangs')}
                >
                  {LANG_OPTIONS.filter((lang) => lang !== sourceLang).map((lang) => {
                    const selected = targetLangs.includes(lang)
                    return (
                      <label
                        key={lang}
                        className={
                          selected
                            ? 'language-multiselect-option selected'
                            : 'language-multiselect-option'
                        }
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleTarget(lang)}
                        />
                        <span className="min-w-0 flex-1">
                          {formatLanguageOption(lang, language)}
                        </span>
                        {selected && <IconCheck size={15} aria-hidden />}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="field-label">
          <span>{t('batch:create.files')}</span>
          <label className="file-drop">
            <input
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <IconUpload size={22} className="text-[var(--color-accent)]" />
            <span>{t('batch:create.dropHint')}</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {t('batch:create.limits', {
                maxFiles: MAX_FILES,
                maxMb: 50,
              })}
            </span>
          </label>
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <span
              className={
                overFileLimit || overSizeLimit ? 'font-semibold text-[var(--color-error)]' : ''
              }
            >
              {t('batch:create.usage', {
                count: files.length,
                maxFiles: MAX_FILES,
                used: formatBytes(totalBytes, language),
                max: formatBytes(MAX_BYTES, language),
              })}
            </span>
          </div>
          {files.length > 0 && (
            <ul className="mt-2 max-h-36 space-y-1 overflow-auto">
              {files.map((f) => (
                <li
                  key={`${f.name}-${f.size}`}
                  className="flex items-center gap-2 rounded-md bg-[var(--color-bg-surface-2)] px-2 py-1.5 text-xs"
                >
                  <IconFile size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="tabular-nums text-[var(--color-text-tertiary)]">
                    {formatBytes(f.size, language)}
                  </span>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                    aria-label={t('common:actions.remove')}
                  >
                    <IconTrash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(overFileLimit || overSizeLimit) && (
          <p className="field-error">
            {overFileLimit
              ? t('batch:create.tooManyFiles', { max: MAX_FILES })
              : t('batch:create.tooLarge', { maxMb: 50 })}
          </p>
        )}
        {error && <p className="field-error">{error}</p>}
        {!projectsLoading && projects.length === 0 && (
          <p className="field-error">{t('batch:create.noProjects')}</p>
        )}
      </form>
    </Modal>
  )
}
