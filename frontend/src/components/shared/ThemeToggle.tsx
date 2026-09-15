import { IconMoon, IconSun } from '@tabler/icons-react'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/cn'

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const theme = useUiStore((s) => s.theme)
  const cycleTheme = useUiStore((s) => s.cycleTheme)

  // In dark mode show sun (switch to light); in light mode show moon.
  const Icon = theme === 'dark' ? IconSun : IconMoon

  return (
    <button
      type="button"
      onClick={cycleTheme}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] transition-all hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]',
        className,
      )}
    >
      <Icon size={18} stroke={1.75} />
    </button>
  )
}
