import { IconChevronDown } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type StudioPanel = {
  id: string
  index: number
  title: string
  subtitle?: string
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
  defaultOpen?: boolean
  children: ReactNode
}

type Props = {
  panels: StudioPanel[]
  /** Single-open section id — only one panel expanded at a time. */
  openId: string | null
  onToggle: (id: string) => void
  className?: string
}

/**
 * Single-open Media Studio accordion.
 *
 * Bodies mount on first open and stay mounted (hidden when collapsed) so
 * in-progress form state is not lost when the user switches sections.
 * Unopened sections stay unmounted until needed.
 */
export function StudioAccordion({ panels, openId, onToggle, className }: Props) {
  const [mountedIds, setMountedIds] = useState<Set<string>>(() =>
    openId ? new Set([openId]) : new Set(),
  )

  useEffect(() => {
    if (!openId) return
    setMountedIds((prev) => {
      if (prev.has(openId)) return prev
      const next = new Set(prev)
      next.add(openId)
      return next
    })
  }, [openId])

  return (
    <div className={cn('media-studio-accordion', className)} data-testid="studio-accordion">
      {panels.map((panel) => {
        const open = openId === panel.id && !panel.disabled
        const mounted = mountedIds.has(panel.id) && !panel.disabled
        return (
          <div
            key={panel.id}
            id={`studio-section-${panel.id}`}
            data-section-id={panel.id}
            data-open={open ? 'true' : 'false'}
            className={cn('media-accordion-item', open && 'open', panel.disabled && 'disabled')}
          >
            <button
              type="button"
              className="media-accordion-trigger"
              disabled={panel.disabled}
              aria-expanded={open}
              aria-controls={`studio-section-body-${panel.id}`}
              onClick={() => onToggle(panel.id)}
            >
              <span className="media-accordion-index">{panel.index}</span>
              {panel.icon && <span className="media-accordion-icon">{panel.icon}</span>}
              <span className="media-accordion-text">
                <span className="media-accordion-title">{panel.title}</span>
                {panel.subtitle && (
                  <span className="media-accordion-subtitle">{panel.subtitle}</span>
                )}
              </span>
              {panel.badge && <span className="media-accordion-badge">{panel.badge}</span>}
              <IconChevronDown
                size={18}
                className={cn('media-accordion-chevron', open && 'rotated')}
              />
            </button>
            {mounted && (
              <div
                id={`studio-section-body-${panel.id}`}
                className="media-accordion-body"
                hidden={!open}
                aria-hidden={!open}
              >
                {panel.children}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
