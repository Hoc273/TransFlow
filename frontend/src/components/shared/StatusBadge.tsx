import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

export type JobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCELLED'

const STATUS_CLASS: Record<JobStatus, string> = {
  PENDING: 'status-badge-pending',
  PROCESSING: 'status-badge-processing',
  COMPLETED: 'status-badge-completed',
  PARTIALLY_FAILED: 'status-badge-partial',
  FAILED: 'status-badge-failed',
  CANCELLED: 'status-badge-cancelled',
}

const STATUS_KEY: Record<JobStatus, string> = {
  PENDING: 'status.pending',
  PROCESSING: 'status.processing',
  COMPLETED: 'status.completed',
  PARTIALLY_FAILED: 'status.partiallyFailed',
  FAILED: 'status.failed',
  CANCELLED: 'status.cancelled',
}

interface StatusBadgeProps {
  status: JobStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation('dashboard')
  const pulse = status === 'PROCESSING'

  return (
    <span className={cn('status-badge', STATUS_CLASS[status], className)}>
      <span className={cn('status-badge-dot', pulse && 'pulse-dot')} />
      {t(STATUS_KEY[status])}
    </span>
  )
}
