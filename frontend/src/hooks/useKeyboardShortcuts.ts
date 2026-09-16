import { useEffect } from 'react'

export type ShortcutHandlers = {
  onPrev?: () => void
  onNext?: () => void
  onEdit?: () => void
  onEscape?: () => void
  onSave?: () => void
  onApprove?: () => void
  onApplyQa?: () => void
  onSearchFocus?: () => void
  onHelp?: () => void
  enabled?: boolean
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

/** E.3 Keyboard shortcuts for Translation Editor. */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const {
    onPrev,
    onNext,
    onEdit,
    onEscape,
    onSave,
    onApprove,
    onApplyQa,
    onSearchFocus,
    onHelp,
    enabled = true,
  } = handlers

  useEffect(() => {
    if (!enabled) return

    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target)
      const mod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        onEscape?.()
        return
      }
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        onSave?.()
        return
      }
      if (mod && e.key === 'Enter') {
        if (!typing) {
          e.preventDefault()
          onApprove?.()
        }
        return
      }

      if (typing) return

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        onPrev?.()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        onNext?.()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onEdit?.()
      } else if (e.key === 'g' || e.key === 'G') {
        onApplyQa?.()
      } else if (e.key === '/') {
        e.preventDefault()
        onSearchFocus?.()
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        onHelp?.()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    enabled,
    onPrev,
    onNext,
    onEdit,
    onEscape,
    onSave,
    onApprove,
    onApplyQa,
    onSearchFocus,
    onHelp,
  ])
}
