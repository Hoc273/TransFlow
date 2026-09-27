import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { IconCheck } from '@tabler/icons-react'
import { cn } from '@/lib/cn'

export type StudioPanel = {
  id: string
  index: number
  title: string
  subtitle?: string
  icon?: ReactNode
  badge?: ReactNode
  /** Step state marker on the tab: finished (✓) or waiting on the user (●). */
  status?: 'done' | 'attention' | null
  disabled?: boolean
  children: ReactNode
}

type Props = {
  panels: StudioPanel[]
  /** Active tab id — falls back to the first enabled panel when unknown/null. */
  activeId: string | null
  onSelect: (id: string) => void
  className?: string
}

/**
 * Media Studio horizontal tabs (sticky tab bar + one visible panel).
 *
 * Panel bodies mount on first activation and stay mounted (hidden when
 * inactive) so in-progress form state is not lost when the user switches tabs.
 * Each panel keeps the `studio-section-<id>` wrapper so workflow milestones can
 * scroll the active tab into view.
 */
export function StudioTabs({ panels, activeId, onSelect, className }: Props) {
  const enabled = panels.filter((p) => !p.disabled)
  const resolvedId =
    enabled.find((p) => p.id === activeId)?.id ?? enabled[0]?.id ?? null

  const [mountedIds, setMountedIds] = useState<Set<string>>(() =>
    resolvedId ? new Set([resolvedId]) : new Set(),
  )
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    if (!resolvedId) return
    setMountedIds((prev) => {
      if (prev.has(resolvedId)) return prev
      const next = new Set(prev)
      next.add(resolvedId)
      return next
    })
    // Keep the active tab visible when the tab bar scrolls horizontally (mobile)
    // — horizontal only, so the page itself never jumps.
    const tab = tabRefs.current.get(resolvedId)
    const list = tab?.parentElement
    if (tab && list && list.scrollWidth > list.clientWidth) {
      const left = tab.offsetLeft - list.offsetLeft
      if (left < list.scrollLeft || left + tab.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = Math.max(0, left - 16)
      }
    }
  }, [resolvedId])

  const focusAndSelect = (id: string) => {
    tabRefs.current.get(id)?.focus()
    onSelect(id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const idx = enabled.findIndex((p) => p.id === id)
    if (idx < 0) return
    let target: StudioPanel | undefined
    if (e.key === 'ArrowRight') target = enabled[(idx + 1) % enabled.length]
    else if (e.key === 'ArrowLeft') target = enabled[(idx - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') target = enabled[0]
    else if (e.key === 'End') target = enabled[enabled.length - 1]
    if (!target) return
    e.preventDefault()
    focusAndSelect(target.id)
  }

  return (
    <div className={cn('media-studio-tabs', className)} data-testid="studio-tabs">
      <div className="media-tabs-bar">
        <div className="media-tabs-list" role="tablist" aria-orientation="horizontal">
          {panels.map((panel) => {
            const active = panel.id === resolvedId
            return (
              <button
                key={panel.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(panel.id, el)
                  else tabRefs.current.delete(panel.id)
                }}
                type="button"
                role="tab"
                id={`studio-tab-${panel.id}`}
                data-tab-id={panel.id}
                aria-selected={active}
                aria-controls={`studio-section-body-${panel.id}`}
                tabIndex={active ? 0 : -1}
                disabled={panel.disabled}
                title={panel.subtitle}
                className={cn('media-tab', active && 'active')}
                onClick={() => onSelect(panel.id)}
                onKeyDown={(e) => onKeyDown(e, panel.id)}
              >
                <span
                  className={cn('media-tab-index', panel.status && `is-${panel.status}`)}
                  data-status={panel.status ?? undefined}
                >
                  {panel.status === 'done' ? <IconCheck size={13} stroke={3} /> : panel.index}
                </span>
                {panel.icon && <span className="media-tab-icon">{panel.icon}</span>}
                <span className="media-tab-title">{panel.title}</span>
                {panel.badge && <span className="media-tab-badge">{panel.badge}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {panels.map((panel) => {
        const open = panel.id === resolvedId
        const mounted = mountedIds.has(panel.id) && !panel.disabled
        return (
          <div
            key={panel.id}
            id={`studio-section-${panel.id}`}
            data-section-id={panel.id}
            data-open={open ? 'true' : 'false'}
            className="media-tab-panel"
            hidden={!open}
          >
            {mounted && (
              <div
                id={`studio-section-body-${panel.id}`}
                role="tabpanel"
                aria-labelledby={`studio-tab-${panel.id}`}
                className="media-tab-panel-body"
              >
                {panel.subtitle && <p className="media-tab-panel-desc">{panel.subtitle}</p>}
                {panel.children}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
