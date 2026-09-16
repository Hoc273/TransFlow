import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconInfoCircle } from '@tabler/icons-react'
import { StageBadge } from '@/components/media-studio/StageBadge'
import { StatusBadge, type JobStatus } from '@/components/shared/StatusBadge'
import { MEDIA_STAGE_STATUSES } from '@/lib/media'

const JOB_STATUSES: JobStatus[] = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
]

type Props = {
  className?: string
}

/** Popover legend: 8 stage + 6 job statuses (19 §1.3 StageLegend). */
export function StageLegend({ className }: Props) {
  const { t } = useTranslation('media')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className={`media-legend-wrap ${className ?? ''}`} ref={ref}>
      <button type="button" className="btn-media-secondary btn-sm" onClick={() => setOpen((v) => !v)}>
        <IconInfoCircle size={14} />
        {t('legend.title')}
      </button>
      {open && (
        <div className="media-legend-popover">
          <div className="media-legend-section">
            <div className="media-legend-title">{t('legend.stages')}</div>
            {MEDIA_STAGE_STATUSES.map((status) => (
              <div key={status} className="media-legend-item">
                <StageBadge status={status} />
                <span className="media-legend-desc">
                  {t(`legend.stageDesc.${status}`, { defaultValue: '' })}
                </span>
              </div>
            ))}
          </div>
          <div className="media-legend-section">
            <div className="media-legend-title">{t('legend.jobs')}</div>
            {JOB_STATUSES.map((status) => (
              <div key={status} className="media-legend-item">
                <StatusBadge status={status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
