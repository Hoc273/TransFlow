import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'

interface FilterOption {
  id: string
  label: string
}

interface MobileSearchFilterProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  filters?: FilterOption[]
  activeFilter?: string
  onFilterChange?: (filterId: string) => void
}

export function MobileSearchFilter({
  value,
  onChange,
  placeholder = 'Tìm kiếm...',
  filters,
  activeFilter,
  onFilterChange,
}: MobileSearchFilterProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="relative min-w-0">
        <IconSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50/50 py-2.5 pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:focus:bg-neutral-900"
        />
      </div>
      {filters && filters.length > 0 && (
        <div className="no-scrollbar -mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 pb-1">
          {filters.map((f) => {
            const active = activeFilter === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onFilterChange?.(f.id)}
                className={clsx(
                  'min-h-[32px] shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors active:scale-95',
                  active
                    ? 'bg-primary text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
                )}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
