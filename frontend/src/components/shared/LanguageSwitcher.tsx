import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconChevronDown, IconWorld } from '@tabler/icons-react'
import { useUiStore, type Language } from '@/store/uiStore'
import { cn } from '@/lib/cn'

interface LanguageSwitcherProps {
  className?: string
  menuPlacement?: 'top' | 'bottom'
  menuAlign?: 'left' | 'right'
}

const LANGUAGES: Array<{ value: Language; code: string; name: string }> = [
  { value: 'vi', code: 'VI', name: 'Tiếng Việt' },
  { value: 'en', code: 'EN', name: 'English' },
]

export function LanguageSwitcher({
  className,
  menuPlacement = 'bottom',
  menuAlign = 'right',
}: LanguageSwitcherProps) {
  const { i18n } = useTranslation()
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const selectedIndex = LANGUAGES.findIndex((option) => option.value === language)
  const selectedLanguage = LANGUAGES[selectedIndex] ?? LANGUAGES[0]

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[selectedIndex]?.focus()
  }, [open, selectedIndex])

  const change = (lang: Language) => {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    localStorage.setItem('tf-lang', lang)
    setOpen(false)
  }

  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const focusOption = (index: number) => {
    const nextIndex = (index + LANGUAGES.length) % LANGUAGES.length
    optionRefs.current[nextIndex]?.focus()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeAndFocusTrigger()
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setOpen(true)
  }

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndFocusTrigger()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(optionIndex + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(optionIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusOption(LANGUAGES.length - 1)
    }
  }

  return (
    <div
      ref={rootRef}
      className="language-select"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={cn('language-select-trigger', className)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        aria-label={`Select language. Current language: ${selectedLanguage.name}.`}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={selectedLanguage.name}
      >
        <IconWorld size={16} stroke={1.75} aria-hidden />
        <span className="language-select-current">{selectedLanguage.code}</span>
        <IconChevronDown
          size={14}
          stroke={1.75}
          className={cn('language-select-chevron', open && 'open')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          className={cn(
            'language-select-menu',
            menuPlacement === 'top' && 'language-select-menu-top',
            menuAlign === 'left' ? 'left-0' : 'right-0',
          )}
          role="listbox"
          aria-label="Language"
        >
          {LANGUAGES.map((option, index) => {
            const selected = option.value === language

            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                type="button"
                className={cn('language-select-option', selected && 'selected')}
                role="option"
                aria-selected={selected}
                onClick={() => change(option.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="language-select-option-code">{option.code}</span>
                <span className="language-select-option-name">{option.name}</span>
                <span className="language-select-option-check" aria-hidden>
                  {selected && <IconCheck size={15} stroke={2} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
