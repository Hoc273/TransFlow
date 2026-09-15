import { useEffect, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import { cn } from '@/lib/cn'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** Wider modal for forms with more fields. */
  size?: 'md' | 'lg' | 'xl'
}

/** Lightweight accessible dialog (09b shared pattern). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'modal-panel',
          size === 'lg' && 'modal-panel-lg',
          size === 'xl' && 'modal-panel-xl',
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="min-w-0">
            <h2 id="modal-title" className="modal-title">
              {title}
            </h2>
            {description && <p className="modal-desc">{description}</p>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
