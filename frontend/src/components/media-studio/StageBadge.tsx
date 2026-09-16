import { cn } from '@/lib/cn'
import type { MediaStageStatus } from '@/types/media'

const KNOWN = new Set([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'STALE',
  'SKIPPED',
  'CANCEL_REQUESTED',
  'CANCELLED',
])

type Props = {
  status: MediaStageStatus
  className?: string
  label?: string
}

export function StageBadge({ status, className, label }: Props) {
  const s = String(status ?? 'PENDING').toUpperCase()
  const safe = KNOWN.has(s) ? s : 'PENDING'
  const pulse = safe === 'PROCESSING' || safe === 'CANCEL_REQUESTED'

  return (
    <span className={cn('media-stage-badge', `media-stage-${safe}`, className)}>
      <span className={cn('media-stage-dot', pulse && 'pulse-dot')} />
      {label ?? safe.replaceAll('_', ' ')}
    </span>
  )
}
