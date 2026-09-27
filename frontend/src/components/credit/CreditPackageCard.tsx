import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { IconCheck } from '@tabler/icons-react'
import { cn } from '@/lib/cn'

export type PackageAccent = 'neutral' | 'blue' | 'emerald'

const ACCENT_STYLES: Record<
  PackageAccent,
  {
    spotlight: string
    gradient: string
    border: string
    selectedBorder: string
    checkBg: string
    selectedText: string
    iconClass: string
  }
> = {
  neutral: {
    spotlight: 'rgba(150, 150, 150, 0.1)',
    gradient: 'from-transparent via-neutral-400/80 dark:via-neutral-500/80 to-transparent',
    border:
      'border-neutral-200 dark:border-white/10 hover:border-neutral-400 dark:hover:border-white/30',
    selectedBorder: 'border-neutral-500 dark:border-white/40 ring-1 ring-neutral-400/30',
    checkBg: 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950',
    selectedText: 'text-neutral-900 dark:text-white',
    iconClass:
      'text-neutral-900 dark:text-white transition-colors duration-300 group-hover:text-black dark:group-hover:text-white',
  },
  blue: {
    spotlight: 'rgba(59, 130, 246, 0.12)',
    gradient: 'from-transparent via-blue-500 to-transparent',
    border:
      'border-blue-500/30 dark:border-blue-500/40 hover:border-blue-500 dark:hover:border-blue-400 ring-1 ring-blue-500/10',
    selectedBorder: 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30',
    checkBg: 'bg-blue-500 text-white',
    selectedText: 'text-blue-600 dark:text-blue-400',
    iconClass:
      'text-neutral-900 dark:text-white transition-all duration-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.4)]',
  },
  emerald: {
    spotlight: 'rgba(16, 185, 129, 0.12)',
    gradient: 'from-transparent via-emerald-500 to-transparent',
    border:
      'border-neutral-200 dark:border-white/10 hover:border-emerald-500/70 dark:hover:border-emerald-500/70',
    selectedBorder: 'border-emerald-500 dark:border-emerald-400 ring-2 ring-emerald-500/30',
    checkBg: 'bg-emerald-500 text-white',
    selectedText: 'text-emerald-600 dark:text-emerald-400',
    iconClass:
      'text-neutral-900 dark:text-white transition-all duration-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]',
  },
}

function TierIcon({ accent, iconClass }: { accent: PackageAccent; iconClass: string }) {
  if (accent === 'blue') {
    return (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" className={iconClass}>
        <circle cx="18" cy="7" r="3" />
        <line x1="18" y1="10" x2="18" y2="28" />
        <circle cx="10" cy="16" r="2.5" />
        <line x1="18" y1="21" x2="10" y2="16" />
        <circle cx="26" cy="16" r="2.5" />
        <line x1="18" y1="21" x2="26" y2="16" />
        <circle cx="9" cy="24" r="2.5" />
        <line x1="18" y1="26" x2="9" y2="24" />
        <circle cx="27" cy="24" r="2.5" />
        <line x1="18" y1="26" x2="27" y2="24" />
      </svg>
    )
  }
  if (accent === 'emerald') {
    return (
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" className={iconClass}>
        <circle cx="18" cy="6" r="3.5" />
        <line x1="18" y1="9.5" x2="18" y2="29" />
        <circle cx="8" cy="14" r="2.5" />
        <line x1="18" y1="19" x2="8" y2="14" />
        <circle cx="28" cy="14" r="2.5" />
        <line x1="18" y1="19" x2="28" y2="14" />
        <circle cx="6" cy="22" r="2.5" />
        <line x1="18" y1="24" x2="6" y2="22" />
        <circle cx="30" cy="22" r="2.5" />
        <line x1="18" y1="24" x2="30" y2="22" />
        <circle cx="11" cy="28" r="2" />
        <line x1="18" y1="28" x2="11" y2="28" />
        <circle cx="25" cy="28" r="2" />
        <line x1="18" y1="28" x2="25" y2="28" />
      </svg>
    )
  }
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.5" className={iconClass}>
      <circle cx="18" cy="8" r="3" />
      <line x1="18" y1="11" x2="18" y2="28" />
      <circle cx="11" cy="18" r="2.5" />
      <line x1="18" y1="21" x2="11" y2="18" />
      <circle cx="25" cy="18" r="2.5" />
      <line x1="18" y1="21" x2="25" y2="18" />
    </svg>
  )
}

interface CreditPackageCardProps {
  name: ReactNode
  credits: ReactNode
  creditsUnit: ReactNode
  price: ReactNode
  selected: boolean
  accent?: PackageAccent
  selectedLabel: string
  onSelect: () => void
}

/**
 * Credit package option mirroring the landing pricing cards
 * (icon, name, price, CTA) — without the features list.
 */
export function CreditPackageCard({
  name,
  credits,
  creditsUnit,
  price,
  selected,
  accent = 'neutral',
  selectedLabel,
  onSelect,
}: CreditPackageCardProps) {
  const style = ACCENT_STYLES[accent]
  const cardRef = useRef<HTMLButtonElement>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  return (
    <button
      ref={cardRef}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-3xl border bg-[#fafafa] p-8 text-left transition-all duration-500 ease-out hover:-translate-y-2 dark:bg-[#13151b] dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)]',
        selected ? style.selectedBorder : style.border,
        selected && 'shadow-md',
      )}
    >
      {/* Cursor spotlight */}
      <div
        className="pointer-events-none absolute -inset-px rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: isHovered
            ? `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, ${style.spotlight}, transparent 80%)`
            : undefined,
        }}
      />

      {/* Top accent line */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r transition-opacity duration-300',
          style.gradient,
          selected || isHovered ? 'opacity-100' : 'opacity-0',
        )}
      />

      {selected && (
        <span
          className={cn(
            'absolute top-4 right-4 z-10 flex h-5 w-5 items-center justify-center rounded-full',
            style.checkBg,
          )}
        >
          <IconCheck size={12} />
        </span>
      )}

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div>
          <div className="mb-6 inline-block transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-translate-y-1">
            <TierIcon accent={accent} iconClass={style.iconClass} />
          </div>

          <h3 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
            {name}
          </h3>

          <div className="mt-1 mb-6 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-neutral-900 dark:text-white">{price}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {credits} {creditsUnit}
            </span>
          </div>

          <div className="mt-auto flex min-h-[44px] items-center pt-5">
            {selected && (
              <span className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', style.selectedText)}>
                <IconCheck size={15} />
                {selectedLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
