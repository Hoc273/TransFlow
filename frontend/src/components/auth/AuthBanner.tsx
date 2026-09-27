import { IconAlertCircle, IconInfoCircle, IconCircleCheck } from '@tabler/icons-react'
import { cn } from '@/lib/cn'

type BannerVariant = 'error' | 'success' | 'info'

interface AuthBannerProps {
  variant: BannerVariant
  message: string
  className?: string
}

export function AuthBanner({ variant, message, className }: AuthBannerProps) {
  const Icon =
    variant === 'error' ? IconAlertCircle : variant === 'success' ? IconCircleCheck : IconInfoCircle

  return (
    <div
      className={cn(
        'mb-5 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-snug',
        variant === 'error' &&
          'border-[rgba(239,68,68,0.2)] bg-[var(--color-error-bg)] text-[var(--color-error)]',
        variant === 'success' &&
          'border-[rgba(16,185,129,0.2)] bg-[rgba(16,185,129,0.08)] text-[var(--color-success)]',
        variant === 'info' &&
          'border-[rgba(99,102,241,0.2)] bg-[rgba(99,102,241,0.08)] text-[var(--color-accent)]',
        className,
      )}
      role="alert"
    >
      <Icon size={16} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  )
}
