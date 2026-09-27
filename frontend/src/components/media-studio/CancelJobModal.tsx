import { useTranslation } from 'react-i18next'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { currentStage } from '@/lib/media'
import type { MediaJob } from '@/types/media'

type Props = {
  open: boolean
  job: MediaJob
  loading?: boolean
  onClose: () => void
  onConfirm: () => void
}

/** Graceful cancel confirm flow (19 §1.3 CancelConfirmFlow / M8.4). */
export function CancelJobModal({ open, job, loading, onClose, onConfirm }: Props) {
  const { t } = useTranslation(['media', 'common'])
  const stage = currentStage(job)
  const stageName = stage?.stageName
    ? t(`stages.${stage.stageName}`, {
        defaultValue: String(stage.stageName).replaceAll('_', ' '),
      })
    : '—'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('media:cancel.title')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            {t('common:actions.close')}
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? t('media:cancel.submitting') : t('media:cancel.confirm')}
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 p-2 text-center">
        <div className="media-confirm-icon warn">
          <IconAlertTriangle size={26} />
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">{t('media:cancel.body')}</p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {t('media:cancel.gracefulHint', { stage: stageName })}
        </p>
      </div>
    </Modal>
  )
}
