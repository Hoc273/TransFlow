import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

interface MobileCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
  interactive?: boolean
}

export function MobileCard({ children, className, interactive = false, ...props }: MobileCardProps) {
  return (
    <div
      className={clsx(
        'w-full min-w-0 overflow-x-clip rounded-xl border border-neutral-200 bg-white p-4 shadow-xs break-words dark:border-neutral-800 dark:bg-neutral-900',
        interactive && 'active:scale-[0.99] transition-transform duration-75 cursor-pointer hover:border-neutral-300 dark:hover:border-neutral-700',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
