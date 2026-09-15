import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

interface LogoProps {
  className?: string
  to?: string
  markClassName?: string
  showWordmark?: boolean
  badge?: string
  variant?: 'landing' | 'auth'
}

export function Logo({
  className,
  to = '/',
  markClassName,
  showWordmark = true,
  badge,
  variant = 'landing',
}: LogoProps) {
  const mark = (
    <div
      className={cn(
        'flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center overflow-visible',
        markClassName,
      )}
    >
      <img
        src="/favicon.svg"
        alt="TransFlow Logo"
        className="h-full w-full object-contain drop-shadow-[0_0_10px_rgba(0,192,255,0.5)] transition-transform hover:scale-105"
      />
    </div>
  )

  const content = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {mark}
      {showWordmark && (
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'text-[16px] sm:text-[18px] font-bold tracking-tight',
              variant === 'auth' && 'text-[19px]',
            )}
          >
            TransFlow
          </span>
          {badge && (
            <span className="lp-mono rounded border border-[var(--color-lp-border-2)] bg-[var(--color-lp-bg-3)] px-1.5 py-0.5 text-[9px] text-[var(--color-lp-text-3)]">
              {badge}
            </span>
          )}
        </span>
      )}
    </span>
  )

  return (
    <Link to={to} className="inline-flex shrink-0 no-underline">
      {content}
    </Link>
  )
}
