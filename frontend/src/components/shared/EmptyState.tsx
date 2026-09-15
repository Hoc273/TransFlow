import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  className?: string
  children?: ReactNode
}

export function EmptyState({ icon, title, description, className, children }: EmptyStateProps) {
  return (
    <div className={cn('empty-state', className)}>
      {icon && (
        <div className="mb-3 flex justify-center text-[var(--color-text-tertiary)]">{icon}</div>
      )}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  )
}
