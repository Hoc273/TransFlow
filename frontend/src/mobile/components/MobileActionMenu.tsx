import type { ReactNode } from 'react'
import { BottomSheet } from './BottomSheet'
import clsx from 'clsx'

export interface MobileActionItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
}

interface MobileActionMenuProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  actions: MobileActionItem[]
}

export function MobileActionMenu({ isOpen, onClose, title, actions }: MobileActionMenuProps) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex min-w-0 flex-col gap-1">
        {actions.map((act, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              act.onClick()
              onClose()
            }}
            className={clsx(
              'flex min-h-[48px] w-full min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors active:bg-neutral-100 dark:active:bg-neutral-800',
              act.danger ? 'text-red-600 dark:text-red-400' : 'text-neutral-800 dark:text-neutral-200'
            )}
          >
            {act.icon && <span className="shrink-0">{act.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{act.label}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
