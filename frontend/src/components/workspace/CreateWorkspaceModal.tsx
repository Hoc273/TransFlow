import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/shared/Modal'
import { useCreateWorkspace } from '@/hooks/useWorkspaces'
import { ApiError } from '@/types/api'

type CreateWorkspaceModalProps = {
  open: boolean
  onClose: () => void
}

/** B.2 — create workspace from switcher (POST /workspaces). */
export function CreateWorkspaceModal({ open, onClose }: CreateWorkspaceModalProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const createWs = useCreateWorkspace()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setError(null)
  }

  const handleClose = () => {
    if (createWs.isPending) return
    reset()
    onClose()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('workspace.nameRequired'))
      return
    }
    createWs.mutate(
      { name: trimmed },
      {
        onSuccess: (ws) => {
          reset()
          onClose()
          navigate(`/w/${ws.id}`)
        },
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : t('error.generic'))
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('workspace.create')}
      description={t('workspace.createHint')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={handleClose} disabled={createWs.isPending}>
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            form="create-workspace-form"
            className="btn-primary"
            disabled={createWs.isPending}
          >
            {createWs.isPending ? t('workspace.creating') : t('workspace.create')}
          </button>
        </>
      }
    >
      <form id="create-workspace-form" onSubmit={onSubmit} className="space-y-3">
        <label className="field-label">
          <span>{t('workspace.nameLabel')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
            placeholder={t('workspace.namePlaceholder')}
            autoFocus
            maxLength={120}
          />
        </label>
        {error && <p className="field-error">{error}</p>}
      </form>
    </Modal>
  )
}
