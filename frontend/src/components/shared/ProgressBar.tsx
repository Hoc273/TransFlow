import { cn } from '@/lib/cn'

interface ProgressBarProps {
  value: number
  max?: number
  variant?: 'default' | 'success' | 'warn' | 'error'
  className?: string
  shimmer?: boolean
}

export function ProgressBar({
  value,
  max = 100,
  variant = 'default',
  className,
  shimmer,
}: ProgressBarProps) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={cn('progress', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn(
          'progress-bar',
          variant === 'success' && 'success',
          variant === 'warn' && 'warn',
          variant === 'error' && 'error',
          shimmer && 'shimmer',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
