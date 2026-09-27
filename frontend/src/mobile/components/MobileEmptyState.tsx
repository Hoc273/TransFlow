import type { ReactNode } from 'react'

interface MobileEmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function MobileEmptyState({ icon, title, description, action }: MobileEmptyStateProps) {
  return (
    <div className="flex w-full min-w-0 flex-col items-center justify-center overflow-x-clip rounded-xl border border-dashed border-neutral-200 p-6 text-center break-words dark:border-neutral-800">
      {icon && <div className="mb-3 text-neutral-400 dark:text-neutral-500">{icon}</div>}
      <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">{title}</h4>
      {description && <p className="mt-1 w-full max-w-xs text-xs text-neutral-500 dark:text-neutral-400">{description}</p>}
      {action && <div className="mt-4 flex w-full flex-col items-center gap-2">{action}</div>}
    </div>
  )
}
