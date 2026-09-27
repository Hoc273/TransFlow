import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconShieldX } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { SeverityBadge } from '@/components/qa/SeverityBadge'
import { cn } from '@/lib/cn'
import { issueBlockingActions } from '@/lib/qa'
import type { BlockingAction, QaIssue } from '@/types/qa'

type Props = {
  open: boolean
  onClose: () => void
  issue: QaIssue
  onSubmit: (issueId: string, body: { blockingAction: BlockingAction; reason: string }) => void
  loading?: boolean
  error?: string | null
}

export function QaOverrideModal({
  open,
  onClose,
  issue,
  onSubmit,
  loading,
  error,
}: Props) {
  const { t } = useTranslation(['job', 'media'])
  const actions = issueBlockingActions(issue)
  const overridden = new Set((issue.overrides ?? []).map((o) => o.blockingAction))
  const remaining = actions.filter((a) => !overridden.has(a))

  // The backend resolves the whole issue on override (every blocking action is lifted);
  // the API still receives one action for compatibility.
  const selectedAction: BlockingAction = remaining[0] ?? ''
  const [reason, setReason] = useState('')
  const MIN_REASON = 10
  const reasonValid = reason.trim().length >= MIN_REASON
  const presets = ['falseAlarm', 'authored', 'checked'] as const

  const handleSubmit = () => {
    if (!selectedAction || !reasonValid) return
    onSubmit(issue.id, { blockingAction: selectedAction, reason: reason.trim() })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('qa.overrideModal.title')}
      description={t('qa.overrideModal.description')}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={loading}>
            {t('qa.overrideModal.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!selectedAction || !reasonValid || loading}
          >
            {loading ? t('qa.overrideModal.submitting') : t('qa.overrideModal.submit')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Issue summary */}
        <div className="flex items-center gap-3 rounded-md bg-[var(--color-bg-surface)] p-3">
          <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            {issue.type}
          </span>
          <SeverityBadge severity={issue.severity} />
          <span className="text-[13px] text-[var(--color-text-secondary)] line-clamp-2">
            {issue.message}
          </span>
        </div>

        {/* Non-overrideable warning */}
        {remaining.length === 0 && (
          <div className="flex items-center gap-2 rounded-md bg-[var(--color-bg-error-subtle)] p-3 text-[13px] text-[var(--color-text-error)]">
            <IconShieldX size={16} />
            {t('qa.overrideModal.allOverridden')}
          </div>
        )}

        {remaining.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-[var(--color-text-secondary)]">{t('qa.overrideModal.liftsLabel')}:</span>
            {remaining.map((a) => (
              <span key={a} className="chip chip-block">
                {t(`media:qa.blocks.${a}`, { defaultValue: a.replace('BLOCK_', '') })}
              </span>
            ))}
          </div>
        )}

        {/* Reason input */}
        {remaining.length > 0 && (
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('qa.overrideModal.reasonLabel')}
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5" aria-label={t('qa.overrideModal.presetsLabel')}>
              {presets.map((key) => {
                const text = t(`qa.overrideModal.presets.${key}`)
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn('media-subtitle-filter-chip', reason === text && 'active')}
                    onClick={() => setReason(text)}
                    data-testid={`override-preset-${key}`}
                  >
                    {text}
                  </button>
                )
              })}
            </div>
            <textarea
              className="input-textarea w-full"
              rows={3}
              placeholder={t('qa.overrideModal.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={MIN_REASON}
            />
            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
              {reason.trim().length < MIN_REASON
                ? t('qa.overrideModal.reasonHint', { min: MIN_REASON })
                : t('qa.overrideModal.reasonOk')}
            </p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-[var(--color-bg-error-subtle)] p-3 text-[13px] text-[var(--color-text-error)]">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
