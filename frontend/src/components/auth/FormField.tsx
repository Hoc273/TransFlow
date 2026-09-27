import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { IconAlertCircle } from '@tabler/icons-react'
import { cn } from '@/lib/cn'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  leftIcon?: ReactNode
  rightSlot?: ReactNode
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  function FormField({ label, error, leftIcon, rightSlot, className, id, ...props }, ref) {
    const inputId = id || props.name

    return (
      <div className="mb-[18px]">
        <label
          htmlFor={inputId}
          className="mb-[7px] block text-[13px] font-medium text-[var(--color-text-secondary)]"
        >
          {label}
        </label>
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full rounded-[11px] border border-[var(--color-border)] bg-[var(--color-bg-surface)] py-3 pr-3.5 text-sm text-[var(--color-text-primary)] outline-none transition-all placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]',
              leftIcon ? 'pl-[42px]' : 'pl-3.5',
              rightSlot && 'pr-11',
              error &&
                'border-[var(--color-error)] bg-[var(--color-error-bg)] focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]',
              className,
            )}
            {...props}
          />
          {rightSlot && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">{rightSlot}</span>
          )}
        </div>
        {error && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-error)]">
            <IconAlertCircle size={13} />
            <span>{error}</span>
          </div>
        )}
      </div>
    )
  },
)
