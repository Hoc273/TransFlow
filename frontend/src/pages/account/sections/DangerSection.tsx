import { useState } from 'react'
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconInfoCircle,
  IconTrash,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/shared/Modal'

/** Delete account shell — no DELETE user API in MVP. */
export function DangerSection() {
  const { t } = useTranslation(['account', 'common'])
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const deletedItems = t('account:danger.deletedItems', { returnObjects: true })
  const keptItems = t('account:danger.keptItems', { returnObjects: true })
  const deleted = Array.isArray(deletedItems) ? (deletedItems as string[]) : []
  const kept = Array.isArray(keptItems) ? (keptItems as string[]) : []

  const close = () => {
    setOpen(false)
    setConfirmText('')
  }

  const onConfirm = () => {
    if (confirmText.trim() !== 'DELETE') return
    close()
    setNote(t('account:danger.pending'))
  }

  return (
    <>
      <div className="account-section danger-zone">
        <div className="account-section-header">
          <div>
            <h2 className="account-section-title flex items-center gap-1.5">
              <IconAlertOctagon size={18} />
              {t('account:danger.title')}
            </h2>
            <p className="account-section-desc">{t('account:danger.desc')}</p>
          </div>
        </div>

        {note && (
          <div className="account-banner info" style={{ color: 'var(--color-accent)' }}>
            <IconInfoCircle size={17} className="shrink-0" />
            <div>{note}</div>
          </div>
        )}

        <div className="account-banner warn mb-4" style={{ color: 'var(--color-error)' }}>
          <IconAlertTriangle size={17} className="shrink-0" />
          <div>{t('account:danger.warning')}</div>
        </div>

        <div className="danger-lists">
          <div className="danger-list-box deleted">
            <div className="danger-list-label">
              <IconTrash size={12} className="mr-1 inline" />
              {t('account:danger.whatDeleted')}
            </div>
            <ul>
              {deleted.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="danger-list-box kept">
            <div className="danger-list-label">{t('account:danger.whatKept')}</div>
            <ul>
              {kept.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-danger-outline" onClick={() => setOpen(true)}>
            <IconTrash size={14} />
            {t('account:danger.button')}
          </button>
        </div>
      </div>

      <div className="account-banner info">
        <IconInfoCircle size={17} className="shrink-0" />
        <div>{t('account:danger.gdprNote')}</div>
      </div>

      <Modal
        open={open}
        onClose={close}
        title={t('account:danger.confirmTitle')}
        description={t('account:danger.confirmDesc')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              {t('account:common.cancel')}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={confirmText.trim() !== 'DELETE'}
              onClick={onConfirm}
            >
              <IconTrash size={14} />
              {t('account:danger.confirmButton')}
            </button>
          </>
        }
      >
        <div className="account-banner warn mb-4" style={{ color: 'var(--color-error)' }}>
          <IconAlertTriangle size={17} className="shrink-0" />
          <div>{t('account:danger.confirmDesc')}</div>
        </div>
        <label className="account-field">
          <span className="account-field-label">
            Confirmation <span className="required">*</span>
          </span>
          <input
            className="field-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t('account:danger.confirmPlaceholder')}
            autoComplete="off"
          />
        </label>
      </Modal>
    </>
  )
}
