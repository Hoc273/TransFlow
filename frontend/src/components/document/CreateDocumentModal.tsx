import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { IconFile, IconUpload } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { useCreateDocument, useUploadDocument } from '@/hooks/useDocuments'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

const ACCEPT = '.txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_BYTES = 10 * 1024 * 1024

type Tab = 'paste' | 'upload'

type CreateDocumentModalProps = {
  open: boolean
  onClose: () => void
  workspaceId: string
  projectId: string
  defaultSourceLang?: string
}

/** C.2 Document intake — paste text or upload .txt/.docx */
export function CreateDocumentModal({
  open,
  onClose,
  workspaceId,
  projectId,
  defaultSourceLang = 'en',
}: CreateDocumentModalProps) {
  const { t } = useTranslation(['document', 'common'])
  const language = useUiStore((state) => state.language)
  const createDoc = useCreateDocument(workspaceId, projectId)
  const uploadDoc = useUploadDocument(workspaceId, projectId)

  const [tab, setTab] = useState<Tab>('paste')
  const [name, setName] = useState('')
  const [sourceLang, setSourceLang] = useState(defaultSourceLang)
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = createDoc.isPending || uploadDoc.isPending

  const reset = () => {
    setTab('paste')
    setName('')
    setSourceLang(defaultSourceLang)
    setContent('')
    setFile(null)
    setError(null)
  }

  const handleClose = () => {
    if (pending) return
    reset()
    onClose()
  }

  const onFile = (list: FileList | null) => {
    setError(null)
    const f = list?.[0]
    if (!f) return
    const lower = f.name.toLowerCase()
    if (!lower.endsWith('.txt') && !lower.endsWith('.docx')) {
      setError(t('document:create.invalidType', { name: f.name }))
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setError(t('document:create.tooLarge'))
      setFile(null)
      return
    }
    setFile(f)
    if (!name.trim()) {
      setName(f.name.replace(/\.(txt|docx)$/i, ''))
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('document:create.nameRequired'))
      return
    }

    if (tab === 'paste') {
      if (!content.trim()) {
        setError(t('document:create.contentRequired'))
        return
      }
      createDoc.mutate(
        { name: trimmedName, sourceLang, content },
        {
          onSuccess: () => {
            reset()
            onClose()
          },
          onError: (err) => {
            setError(err instanceof ApiError ? err.message : t('common:error.generic'))
          },
        },
      )
      return
    }

    if (!file) {
      setError(t('document:create.fileRequired'))
      return
    }
    uploadDoc.mutate(
      { file, name: trimmedName, sourceLang },
      {
        onSuccess: () => {
          reset()
          onClose()
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('document:create.title')}
      description={t('document:create.subtitle')}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" disabled={pending} onClick={handleClose}>
            {t('common:actions.cancel')}
          </button>
          <button type="submit" form="create-document-form" className="btn-primary" disabled={pending}>
            {pending ? t('document:create.submitting') : t('document:create.submit')}
          </button>
        </>
      }
    >
      <form id="create-document-form" onSubmit={onSubmit} className="space-y-3">
        {error && <div className="field-error">{error}</div>}

        <div className="flex gap-1 rounded-lg bg-[var(--color-bg-surface-2)] p-1">
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === 'paste'
                ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-secondary)]'
            }`}
            onClick={() => setTab('paste')}
          >
            {t('document:create.tabPaste')}
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === 'upload'
                ? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm'
                : 'text-[var(--color-text-secondary)]'
            }`}
            onClick={() => setTab('upload')}
          >
            {t('document:create.tabUpload')}
          </button>
        </div>

        <label className="field-label">
          <span>{t('document:create.name')}</span>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('document:create.namePlaceholder')}
            required
            maxLength={300}
          />
        </label>

        <label className="field-label">
          <span>{t('document:create.sourceLang')}</span>
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

        {tab === 'paste' ? (
          <label className="field-label">
            <span>{t('document:create.content')}</span>
            <textarea
              className="field-input min-h-[160px] font-mono text-[13px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('document:create.contentPlaceholder')}
              required
            />
          </label>
        ) : (
          <div>
            <div className="field-label mb-1">
              <span>{t('document:create.file')}</span>
            </div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-2)] px-4 py-8 text-center transition hover:border-[var(--color-accent)]">
              <IconUpload size={22} className="text-[var(--color-accent)]" />
              <span className="text-sm text-[var(--color-text-secondary)]">
                {t('document:create.dropHint')}
              </span>
              <span className="text-[11px] text-[var(--color-text-tertiary)]">
                {t('document:create.fileHint')}
              </span>
              <input
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => onFile(e.target.files)}
              />
            </label>
            {file && (
              <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <IconFile size={16} />
                <span className="truncate">{file.name}</span>
                <span className="text-[var(--color-text-tertiary)]">
                  ({Math.round(file.size / 1024)} KB)
                </span>
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
