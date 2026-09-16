import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react'
import type { ReactNode } from 'react'

export type SortDir = 'asc' | 'desc'

type Props = {
  label: ReactNode
  active: boolean
  dir: SortDir
  onSort: () => void
  className?: string
  align?: 'left' | 'center' | 'right'
}

/** Clickable table header with asc/desc indicator (client-side sort). */
export function SortableTh({ label, active, dir, onSort, className = '', align = 'left' }: Props) {
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th className={`${alignCls} ${className}`.trim()}>
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider transition hover:text-[var(--color-text-primary)]"
        onClick={onSort}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <IconChevronUp size={12} className="text-[var(--color-accent)]" />
          ) : (
            <IconChevronDown size={12} className="text-[var(--color-accent)]" />
          )
        ) : (
          <IconSelector size={12} className="opacity-40" />
        )}
      </button>
    </th>
  )
}

export function toggleSort<K extends string>(
  currentKey: K | null,
  currentDir: SortDir,
  nextKey: K,
): { key: K; dir: SortDir } {
  if (currentKey === nextKey) {
    return { key: nextKey, dir: currentDir === 'asc' ? 'desc' : 'asc' }
  }
  return { key: nextKey, dir: 'asc' }
}

export function compareValues(a: string | number | boolean | null | undefined, b: string | number | boolean | null | undefined, dir: SortDir): number {
  const mul = dir === 'asc' ? 1 : -1
  if (a == null && b == null) return 0
  if (a == null) return 1 * mul
  if (b == null) return -1 * mul
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mul
  if (typeof a === 'boolean' && typeof b === 'boolean') return (Number(a) - Number(b)) * mul
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }) * mul
}

/** Stable color pair for avatar gradients from a string seed. */
export function avatarGradient(seed: string): string {
  const palettes = [
    'platform-avatar-tone-1',
    'platform-avatar-tone-2',
    'platform-avatar-tone-3',
    'platform-avatar-tone-4',
    'platform-avatar-tone-5',
    'platform-avatar-tone-6',
    'platform-avatar-tone-7',
    'platform-avatar-tone-8',
  ]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palettes[h % palettes.length]
}
