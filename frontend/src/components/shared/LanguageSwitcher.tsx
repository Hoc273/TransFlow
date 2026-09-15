import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconChevronDown, IconLanguage, IconSparkles } from '@tabler/icons-react'
import { useUiStore, type Language } from '@/store/uiStore'
import { cn } from '@/lib/cn'

interface LanguageSwitcherProps {
  className?: string
  menuPlacement?: 'top' | 'bottom'
  menuAlign?: 'left' | 'right'
}

function FlagVN({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="12" fill="#DA251D" />
      <polygon
        fill="#FFEB3B"
        points="12,4.8 14.2,11.6 21.4,11.6 15.6,15.8 17.8,22.6 12,18.4 6.2,22.6 8.4,15.8 2.6,11.6 9.8,11.6"
      />
    </svg>
  )
}

function FlagUS({ className = 'w-6 h-6' }: { className?: string }) {
  const maskId = useId()
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <circle cx="12" cy="12" r="12" fill="#FFFFFF" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect width="24" height="24" fill="#B22234" />
        <path
          d="M0 3.69h24v1.85H0zM0 7.38h24v1.85H0zM0 11.08h24v1.85H0zM0 14.77h24v1.85H0zM0 18.46h24v1.85H0zM0 22.15h24v1.85H0z"
          fill="#FFFFFF"
        />
        <rect width="11" height="13" fill="#3C3B6E" />
        <circle cx="2.5" cy="3" r="0.8" fill="#FFFFFF" />
        <circle cx="5.5" cy="3" r="0.8" fill="#FFFFFF" />
        <circle cx="8.5" cy="3" r="0.8" fill="#FFFFFF" />
        <circle cx="4" cy="5.5" r="0.8" fill="#FFFFFF" />
        <circle cx="7" cy="5.5" r="0.8" fill="#FFFFFF" />
        <circle cx="2.5" cy="8" r="0.8" fill="#FFFFFF" />
        <circle cx="5.5" cy="8" r="0.8" fill="#FFFFFF" />
        <circle cx="8.5" cy="8" r="0.8" fill="#FFFFFF" />
        <circle cx="4" cy="10.5" r="0.8" fill="#FFFFFF" />
        <circle cx="7" cy="10.5" r="0.8" fill="#FFFFFF" />
      </g>
    </svg>
  )
}

interface LanguageOption {
  value: Language
  code: string
  name: string
  sublabel: string
  flag: typeof FlagVN
}

const LANGUAGES: LanguageOption[] = [
  {
    value: 'vi',
    code: 'VI',
    name: 'Tiếng Việt',
    sublabel: 'Việt Nam · Mặc định',
    flag: FlagVN,
  },
  {
    value: 'en',
    code: 'EN',
    name: 'English',
    sublabel: 'United States · US',
    flag: FlagUS,
  },
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

  // Chuẩn hoá ngôn ngữ hiện hành (ví dụ: 'vi-VN' -> 'vi')
  const activeLang: Language = (i18n.language || language || 'vi')
    .toLowerCase()
    .startsWith('vi')
    ? 'vi'
    : 'en'
  const selectedIndex = LANGUAGES.findIndex((option) => option.value === activeLang)
  const selectedLanguage = LANGUAGES[selectedIndex] ?? LANGUAGES[0]
  const CurrentFlag = selectedLanguage.flag

  // Đóng khi nhấp bên ngoài
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      optionRefs.current[selectedIndex]?.focus()
    }
  }, [open, selectedIndex])

  const change = (lang: Language) => {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    localStorage.setItem('tf-lang', lang)
    localStorage.setItem('app_language', lang)
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

    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault()
      setOpen((curr) => !curr)
    }
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

    if (event.key === 'Tab') {
      setOpen(false)
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

  const isVi = activeLang === 'vi'

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      {/* Nút bấm mở popover */}
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'group inline-flex items-center justify-center gap-2 cursor-pointer select-none',
          'h-9 px-2.5 sm:px-3 rounded-xl text-xs font-semibold',
          'border border-neutral-200/90 dark:border-white/10 bg-white/80 dark:bg-[#13151b]/80 backdrop-blur-md',
          'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.08] hover:text-neutral-900 dark:hover:text-white',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#714ffc]/60 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-neutral-900',
          'shadow-xs hover:shadow-sm transition-all duration-200',
          open &&
            'bg-neutral-100 dark:bg-white/10 border-neutral-300 dark:border-white/20 text-neutral-900 dark:text-white shadow-xs',
          className,
        )}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        aria-label={`Select language. Current language: ${selectedLanguage.name}.`}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={selectedLanguage.name}
      >
        <div className="flex items-center justify-center shrink-0 drop-shadow-xs">
          <CurrentFlag className="w-[18px] h-[18px] rounded-full ring-1 ring-black/10 dark:ring-white/15" />
        </div>
        <span className="text-[12px] font-bold font-mono uppercase tracking-wide">
          {selectedLanguage.code}
        </span>
        <IconChevronDown
          size={13}
          stroke={2.2}
          className={cn(
            'text-neutral-400 dark:text-neutral-500 transition-transform duration-200 shrink-0',
            open && 'rotate-180 text-neutral-700 dark:text-neutral-200',
          )}
          aria-hidden="true"
        />
      </button>

      {/* Menu Popup Card hiện đại */}
      {open && (
        <div
          id={menuId}
          className={cn(
            'absolute z-[100] w-72 p-2.5 rounded-2xl',
            'bg-white/95 dark:bg-[#12141d]/95 backdrop-blur-2xl',
            'border border-neutral-200/90 dark:border-white/10',
            'shadow-[0_20px_50px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.7),0_0_1px_1px_rgba(255,255,255,0.08)]',
            'animate-in fade-in-0 zoom-in-95 duration-150',
            menuPlacement === 'top'
              ? 'bottom-full mb-2 origin-bottom'
              : 'top-full mt-2 origin-top',
            menuAlign === 'left' ? 'left-0 origin-top-left' : 'right-0 origin-top-right',
          )}
          role="listbox"
          aria-label={isVi ? 'Chọn ngôn ngữ giao diện' : 'Select interface language'}
        >
          {/* Header với Icon và Tiêu đề */}
          <div className="flex items-center justify-between px-2 py-1.5 mb-1.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#714ffc]/10 dark:bg-[#714ffc]/20 text-[#714ffc] dark:text-[#a78bff] flex items-center justify-center shrink-0">
                <IconLanguage size={16} stroke={2.2} />
              </div>
              <div className="leading-tight">
                <div className="text-[12px] font-bold text-neutral-800 dark:text-neutral-100">
                  {isVi ? 'Ngôn ngữ hiển thị' : 'Display Language'}
                </div>
                <div className="text-[10.5px] text-neutral-400 dark:text-neutral-500">
                  {isVi ? 'Chọn giao diện bạn muốn dùng' : 'Choose interface language'}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-white/[0.08] text-neutral-500 dark:text-neutral-400">
              {activeLang.toUpperCase()}
            </span>
          </div>

          <div className="my-1 border-t border-neutral-100 dark:border-white/[0.08]" />

          {/* Danh sách các ngôn ngữ */}
          <div className="space-y-1 py-1">
            {LANGUAGES.map((option, index) => {
              const selected = option.value === activeLang
              const FlagComponent = option.flag

              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[index] = node
                  }}
                  type="button"
                  className={cn(
                    'group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer select-none text-left transition-all duration-150',
                    selected
                      ? 'bg-[#714ffc]/[0.08] dark:bg-[#714ffc]/20 border border-[#714ffc]/30 dark:border-[#714ffc]/50 text-neutral-900 dark:text-white shadow-xs'
                      : 'border border-transparent text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/80 dark:hover:bg-white/[0.06] hover:text-neutral-900 dark:hover:text-white',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#714ffc]/50',
                  )}
                  role="option"
                  aria-selected={selected}
                  onClick={() => change(option.value)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0 flex items-center justify-center drop-shadow-xs">
                      <FlagComponent className="w-6 h-6 rounded-full ring-1 ring-black/10 dark:ring-white/20" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold tracking-tight">
                          {option.name}
                        </span>
                        {selected && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-[#714ffc] text-white">
                            {isVi ? 'Hiện tại' : 'Active'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">
                        {option.sublabel}
                      </div>
                    </div>
                  </div>

                  {/* Radio Checkmark Circle */}
                  <div className="shrink-0 flex items-center justify-center">
                    {selected ? (
                      <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#714ffc] to-[#8c67ff] text-white flex items-center justify-center shadow-xs">
                        <IconCheck size={12} stroke={3} />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-neutral-300 dark:border-neutral-700 group-hover:border-neutral-400 dark:group-hover:border-neutral-500 transition-colors" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer thông tin nhỏ */}
          <div className="mt-1 pt-2 border-t border-neutral-100 dark:border-white/[0.08] px-2 flex items-center justify-between text-[11px] text-neutral-400 dark:text-neutral-500">
            <div className="flex items-center gap-1.5">
              <IconSparkles size={12} className="text-[#714ffc] dark:text-[#a78bff]" />
              <span>{isVi ? 'Lưu tự động trên máy' : 'Saved to this browser'}</span>
            </div>
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500">TransFlow</span>
          </div>
        </div>
      )}
    </div>
  )
}
