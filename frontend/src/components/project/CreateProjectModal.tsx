import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/shared/Modal'
import { useCreateProject } from '@/hooks/useProjects'
import { useGlossaries } from '@/hooks/useGlossary'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

type CreateProjectModalProps = {
  open: boolean
  onClose: () => void
  workspaceId: string
  onCreated?: (projectId: string) => void
}

/** C.1 Create project — POST /workspaces/{ws}/projects */
export function CreateProjectModal({
  open,
  onClose,
  workspaceId,
  onCreated,
}: CreateProjectModalProps) {
  const { t } = useTranslation(['project', 'common'])
  const language = useUiStore((state) => state.language)
  const create = useCreateProject(workspaceId)
  const { data: glossaries = [] } = useGlossaries(workspaceId)

  const [name, setName] = useState('')
  const [sourceLang, setSourceLang] = useState('en')
  const [defaultGlossaryId, setDefaultGlossaryId] = useState('')
  const [domain, setDomain] = useState('')
  const [tone, setTone] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setSourceLang('en')
    setDefaultGlossaryId('')
    setDomain('')
    setTone('')
    setError(null)
  }

  const handleClose = () => {
    if (create.isPending) return
    reset()
    onClose()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('project:create.nameRequired'))
      return
    }
    create.mutate(
      {
        name: trimmed,
        sourceLang,
        defaultGlossaryId: defaultGlossaryId || null,
        domain: domain.trim() || null,
        tone: tone.trim() || null,
      },
      {
        onSuccess: (p) => {
          reset()
          onClose()
          onCreated?.(p.id)
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
      title={t('project:create.title')}
      description={t('project:create.subtitle')}
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            disabled={create.isPending}
            onClick={handleClose}
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="submit"
            form="create-project-form"
            className="btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? t('project:create.submitting') : t('project:create.submit')}
          </button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={onSubmit} className="space-y-3">
        {error && <div className="field-error">{error}</div>}

        <label className="field-label">
          <span>{t('project:create.name')}</span>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('project:create.namePlaceholder')}
            autoFocus
            required
            maxLength={200}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            <span>{t('project:create.sourceLang')}</span>
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
            <span>{t('project:create.glossary')}</span>
            <select
              className="field-select"
              value={defaultGlossaryId}
              onChange={(e) => setDefaultGlossaryId(e.target.value)}
            >
              <option value="">{t('project:create.glossaryNone')}</option>
              {glossaries.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            <span>{t('project:create.domain')}</span>
            <input
              className="field-input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t('project:create.domainPlaceholder')}
              maxLength={80}
            />
          </label>
          <label className="field-label">
            <span>{t('project:create.tone')}</span>
            <input
              className="field-input"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder={t('project:create.tonePlaceholder')}
              maxLength={80}
            />
          </label>
        </div>
      </form>
    </Modal>
  )
}
