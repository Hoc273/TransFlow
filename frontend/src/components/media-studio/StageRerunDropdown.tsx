import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconRotate2 } from '@tabler/icons-react'
import type { MediaJob, MediaJobStage } from '@/types/media'
import { orderedMediaStages, currentStage } from '@/lib/media'
import { Modal } from '@/components/shared/Modal'

export type StageRerunDropdownProps = {
  job: MediaJob
  canEdit: boolean
  onRerun: (stageName: string) => Promise<void> | void
  isPending?: boolean
}

export function StageRerunDropdown({
  job,
  canEdit,
  onRerun,
  isPending = false,
}: StageRerunDropdownProps) {
  const { t } = useTranslation(['media', 'common'])
  const [open, setOpen] = useState(false)
  const [confirmStage, setConfirmStage] = useState<MediaJobStage['stageName'] | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const stages = orderedMediaStages(job)
  const current = currentStage(job)
  const maxOrder = current?.stageOrder ?? Infinity
  const eligibleStages = stages.filter(
    (s) => s.status !== 'SKIPPED' && s.stageOrder <= maxOrder,
  )

  const isAnyProcessing = stages.some((s) => s.status === 'PROCESSING')
  const disabled = !canEdit || isPending || isAnyProcessing || eligibleStages.length === 0

  if (!canEdit || eligibleStages.length === 0) return null

  return (
    <>
      <div className="app-dropdown inline-block" ref={menuRef}>
        <button
          type="button"
          className="btn-media-secondary btn-sm inline-flex items-center gap-1.5"
          data-testid="stage-rerun-dropdown-trigger"
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
          title={
            isAnyProcessing
              ? t('media:pipeline.rerunProcessingBlocked', {
                  defaultValue: 'Đang có bước xử lý, không thể chạy lại',
                })
              : undefined
          }
        >
          <IconRotate2 size={13} />
          <span>{t('media:pipeline.rerunFromStage')}</span>
          <IconChevronDown size={12} />
        </button>

        {open && (
          <div
            className="app-dropdown-menu"
            role="menu"
            data-testid="stage-rerun-menu"
            style={{ minWidth: 240, right: 0, left: 'auto' }}
          >
            <div className="border-b border-[var(--color-border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
              {t('media:pipeline.rerunFromStageDesc')}
            </div>
            <div className="py-1">
              {eligibleStages.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="app-dropdown-item flex items-center justify-between"
                  data-testid={`stage-rerun-item-${s.stageName}`}
                  onClick={() => {
                    setOpen(false)
                    setConfirmStage(s.stageName)
                  }}
                >
                  <span className="font-medium text-xs">
                    {t(`media:stages.${s.stageName}`, {
                      defaultValue: s.stageName.replaceAll('_', ' '),
                    })}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)] font-mono uppercase">
                    {s.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {confirmStage && (
        <Modal
          open={!!confirmStage}
          onClose={() => setConfirmStage(null)}
          title={t('media:pipeline.rerunConfirmTitle', {
            stage: t(`media:stages.${confirmStage}`, {
              defaultValue: confirmStage.replaceAll('_', ' '),
            }),
          })}
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('media:pipeline.rerunConfirmDesc', {
                stage: t(`media:stages.${confirmStage}`, {
                  defaultValue: confirmStage.replaceAll('_', ' '),
                }),
              })}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmStage(null)}
                disabled={isPending}
              >
                {t('common:actions.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="stage-rerun-confirm-btn"
                disabled={isPending}
                onClick={async () => {
                  const stageToRerun = confirmStage
                  setConfirmStage(null)
                  if (stageToRerun) {
                    await onRerun(stageToRerun)
                  }
                }}
              >
                {t('media:pipeline.rerunConfirmBtn')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
