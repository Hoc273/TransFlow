import type { JobStatus } from '@/components/shared/StatusBadge'

const KNOWN: JobStatus[] = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'FAILED',
  'CANCELLED',
]

export function asJobStatus(status: string | undefined | null): JobStatus {
  const s = String(status ?? 'PENDING').toUpperCase()
  return (KNOWN as string[]).includes(s) ? (s as JobStatus) : 'PENDING'
}

export function progressVariant(status: string | undefined | null): 'default' | 'success' | 'warn' | 'error' {
  const s = String(status ?? '').toUpperCase()
  if (s === 'COMPLETED') return 'success'
  if (s === 'PARTIALLY_FAILED') return 'warn'
  if (s === 'FAILED') return 'error'
  return 'default'
}

export function isTerminalBatchStatus(status: string | undefined | null): boolean {
  const s = String(status ?? '').toUpperCase()
  return s === 'COMPLETED' || s === 'FAILED' || s === 'PARTIALLY_FAILED' || s === 'CANCELLED'
}

export function isActiveBatchStatus(status: string | undefined | null): boolean {
  const s = String(status ?? '').toUpperCase()
  return s === 'PENDING' || s === 'PROCESSING'
}
