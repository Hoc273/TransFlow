import { useEffect, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import clsx from 'clsx'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function BottomSheet({ isOpen, onClose, title, children, className }: BottomSheetProps) {
  useEffect(() => {
    if (!isOpen) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end overflow-x-clip">
      <button
        type="button"
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        aria-label="Close backdrop"
        onClick={onClose}
      />
      <div
        className={clsx(
          'relative z-10 flex max-h-[85dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 shadow-2xl pb-[env(safe-area-inset-bottom,0px)]',
          className
        )}
      >
        <div className="relative flex min-h-[52px] items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 px-4 py-3">
          <div className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          <div className="flex min-w-0 flex-1 items-center gap-2 pt-1">
            {title && <h3 className="truncate text-base font-semibold text-neutral-900 dark:text-white">{title}</h3>}
          </div>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
            aria-label="Close sheet"
            onClick={onClose}
          >
            <IconX size={20} />
          </button>
        </div>
        <div className="min-w-0 overflow-y-auto overscroll-contain p-4">
          {children}
        </div>
      </div>
    </div>
  )
}
