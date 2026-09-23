import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCoin,
  IconCrown,
  IconSearch,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react'
import {
  SortableTh,
  avatarGradient,
  compareValues,
  toggleSort,
  type SortDir,
} from '@/components/platform/SortableTh'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformUsers, useAdminAdjustUserCredit } from '@/hooks/usePlatform'
import { formatDateTime, initialsFromName } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { PlatformUserItem } from '@/types/platform'

type SortKey = 'user' | 'status' | 'platform' | 'workspaces' | 'joined'

function statusBadgeClass(status: string) {
  const s = status?.toUpperCase() ?? ''
  if (s === 'ACTIVE') return 'platform-pill platform-pill-success'
  if (s === 'PENDING' || s === 'INVITED') return 'platform-pill platform-pill-warn'
  if (s === 'SUSPENDED' || s === 'DISABLED' || s === 'INACTIVE') return 'platform-pill platform-pill-muted'
  return 'platform-pill platform-pill-muted'
}

// ---------------------------------------------------------------------------
// Grant Credit Modal
// ---------------------------------------------------------------------------
function GrantCreditModal({
  user,
  onClose,
}: {
  user: PlatformUserItem
  onClose: () => void
}) {
  const { t } = useTranslation('platform')
  const adjustMutation = useAdminAdjustUserCredit()

  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'grant' | 'deduct'>('grant')
  const [success, setSuccess] = useState<{ balanceBefore: number; balanceAfter: number } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) return
    const finalAmount = mode === 'grant' ? numAmount : -numAmount
    try {
      const res = await adjustMutation.mutateAsync({
        userId: user.id,
        req: { amount: finalAmount, reason: reason.trim() || undefined },
      })
      setSuccess({ balanceBefore: res.balanceBefore, balanceAfter: res.balanceAfter })
    } catch {
      // error shown via adjustMutation.error
    }
  }

  const name = user.fullName || user.email

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--card)] shadow-2xl border border-[var(--color-border)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <IconCoin size={20} className="text-[var(--color-accent)]" />
            <h2 className="font-semibold text-base">
              {t('users.creditModal.title', 'Điều chỉnh Credit')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--elevated)] transition-colors"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="px-6 py-4">
          {/* Target user */}
          <div className="mb-4 rounded-xl bg-[var(--elevated)] px-4 py-3 text-sm">
            <span className="text-[var(--color-text-secondary)]">
              {t('users.creditModal.target', 'Người dùng')}:{' '}
            </span>
            <span className="font-semibold">{name}</span>
            <span className="ml-1 font-mono text-[11px] text-[var(--color-text-tertiary)]">
              ({user.email})
            </span>
          </div>

          {success ? (
            /* Success state */
            <div className="space-y-4">
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                ✓ {t('users.creditModal.success', 'Điều chỉnh credit thành công!')}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-[var(--elevated)] p-3">
                  <div className="text-xs text-[var(--color-text-tertiary)] mb-1">
                    {t('users.creditModal.balanceBefore', 'Số dư trước')}
                  </div>
                  <div className="font-mono font-bold">{success.balanceBefore.toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-[var(--elevated)] p-3">
                  <div className="text-xs text-[var(--color-text-tertiary)] mb-1">
                    {t('users.creditModal.balanceAfter', 'Số dư sau')}
                  </div>
                  <div className="font-mono font-bold text-[var(--color-accent)]">
                    {success.balanceAfter.toFixed(2)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary w-full"
              >
                {t('common.close', 'Đóng')}
              </button>
            </div>
          ) : (
            /* Form */
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {/* Mode toggle: Grant / Deduct */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
                  {t('users.creditModal.modeLabel', 'Loại điều chỉnh')}
                </label>
                <div className="flex rounded-xl border border-[var(--color-border)] overflow-hidden text-sm">
                  <button
                    type="button"
                    onClick={() => setMode('grant')}
                    className={`flex-1 py-2 transition-colors ${
                      mode === 'grant'
                        ? 'bg-[var(--color-accent)] text-white font-semibold'
                        : 'bg-[var(--elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
                    }`}
                  >
                    + {t('users.creditModal.grant', 'Cấp thêm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('deduct')}
                    className={`flex-1 py-2 transition-colors ${
                      mode === 'deduct'
                        ? 'bg-red-500 text-white font-semibold'
                        : 'bg-[var(--elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
                    }`}
                  >
                    − {t('users.creditModal.deduct', 'Khấu trừ')}
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
                  {t('users.creditModal.amount', 'Số lượng credit')} <span className="text-[var(--color-error)]">*</span>
                </label>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  className="input w-full"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Reason */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
                  {t('users.creditModal.reason', 'Lý do (tuỳ chọn)')}
                </label>
                <textarea
                  className="input w-full resize-none"
                  rows={2}
                  placeholder={t('users.creditModal.reasonPlaceholder', 'Ví dụ: Hỗ trợ kỹ thuật, tặng thưởng...')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={255}
                />
              </div>

              {/* Error */}
              {adjustMutation.isError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {adjustMutation.error instanceof ApiError && adjustMutation.error.status === 402
                    ? t('users.creditModal.insufficient')
                    : t('users.creditModal.error')}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary flex-1"
                  disabled={adjustMutation.isPending}
                >
                  {t('common.cancel', 'Huỷ')}
                </button>
                <button
                  type="submit"
                  className={`flex-1 ${mode === 'deduct' ? 'bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl py-2 px-4 transition-colors' : 'btn-primary'}`}
                  disabled={adjustMutation.isPending || !amount || parseFloat(amount) <= 0}
                >
                  {adjustMutation.isPending
                    ? t('common.loading', 'Đang xử lý...')
                    : mode === 'grant'
                      ? t('users.creditModal.confirmGrant', 'Cấp credit')
                      : t('users.creditModal.confirmDeduct', 'Khấu trừ')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function PlatformUsersPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')
  const [adminsOnly, setAdminsOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [creditModalUser, setCreditModalUser] = useState<PlatformUserItem | null>(null)
  const size = 20

  const { data, isLoading, isError, refetch } = usePlatformUsers({
    q: qApplied || undefined,
    page,
    size,
    isPlatformAdmin: adminsOnly ? true : undefined,
  })

  useDocumentTitle(t('users.title'))

  const applySearch = () => {
    setPage(0)
    setQApplied(q.trim())
  }

  const clearSearch = () => {
    setQ('')
    setQApplied('')
    setPage(0)
  }

  const onSort = (key: SortKey) => {
    const next = toggleSort(sortKey, sortDir, key)
    setSortKey(next.key)
    setSortDir(next.dir)
  }

  const rows = useMemo(() => {
    const list = data?.content ? [...data.content] : []
    if (!sortKey) return list
    list.sort((a, b) => {
      switch (sortKey) {
        case 'user':
          return compareValues(
            `${a.fullName ?? ''} ${a.email}`.trim(),
            `${b.fullName ?? ''} ${b.email}`.trim(),
            sortDir,
          )
        case 'status':
          return compareValues(a.status, b.status, sortDir)
        case 'platform':
          return compareValues(a.isPlatformAdmin, b.isPlatformAdmin, sortDir)
        case 'workspaces':
          return compareValues(a.workspaceCount, b.workspaceCount, sortDir)
        case 'joined':
          return compareValues(a.createdAt, b.createdAt, sortDir)
        default:
          return 0
      }
    })
    return list
  }, [data?.content, sortKey, sortDir])

  return (
    <div className="platform-content">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('users.title')}</h1>
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('users.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
          <div className="relative min-w-[240px] max-w-md flex-1">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              className="input w-full !pl-9 pr-8"
              placeholder={t('users.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch()
              }}
            />
            {q && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                title={t('common.clear', 'Xoá')}
                aria-label="Clear search"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              className="rounded border-[var(--color-border-strong)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
              checked={adminsOnly}
              onChange={(e) => {
                setPage(0)
                setAdminsOnly(e.target.checked)
              }}
            />
            <span>{t('users.platformOnly')}</span>
          </label>
          <button type="button" className="btn-secondary py-2 text-xs" onClick={applySearch}>
            {t('overview.apply')}
          </button>
          <span className="ml-auto text-xs tabular-nums text-[var(--color-text-tertiary)]">
            {data ? t('pagination.total', { count: data.totalElements }) : '—'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <SortableTh
                  label={t('users.col.user')}
                  active={sortKey === 'user'}
                  dir={sortDir}
                  onSort={() => onSort('user')}
                />
                <SortableTh
                  label={t('users.col.status')}
                  active={sortKey === 'status'}
                  dir={sortDir}
                  onSort={() => onSort('status')}
                />
                <SortableTh
                  label={t('users.col.platformAdmin')}
                  active={sortKey === 'platform'}
                  dir={sortDir}
                  onSort={() => onSort('platform')}
                  align="center"
                />
                <SortableTh
                  label={t('users.col.workspaces')}
                  active={sortKey === 'workspaces'}
                  dir={sortDir}
                  onSort={() => onSort('workspaces')}
                  align="right"
                />
                <SortableTh
                  label={t('users.col.joined')}
                  active={sortKey === 'joined'}
                  dir={sortDir}
                  onSort={() => onSort('joined')}
                  className="col-hide-mobile"
                />
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  {t('users.col.actions', 'Thao tác')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('users.empty')}
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    language={language}
                    t={t}
                    onGrantCredit={() => setCreditModalUser(u)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && (
          <div className="border-t border-[var(--color-border)] px-4 py-3">
            <PlatformPagination
              page={data.page}
              totalPages={data.totalPages}
              totalElements={data.totalElements}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {creditModalUser && (
        <GrantCreditModal
          user={creditModalUser}
          onClose={() => setCreditModalUser(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UserRow
// ---------------------------------------------------------------------------
function UserRow({
  user: u,
  language,
  t,
  onGrantCredit,
}: {
  user: PlatformUserItem
  language: string
  t: (k: string, fallback?: string) => string
  onGrantCredit: () => void
}) {
  const name = u.fullName || u.email
  const initials = initialsFromName(name)
  const grad = avatarGradient(u.email || u.id)

  return (
    <tr>
      <td>
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold platform-avatar-text ring-2 ring-[var(--card)] overflow-hidden ${grad}`}
          >
            {u.avatarUrl ? (
              <img src={u.avatarUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="truncate">{name}</span>
              {u.isPlatformAdmin && (
                <IconShieldCheck size={14} className="shrink-0 text-[var(--color-accent)]" />
              )}
            </div>
            <div className="truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {u.email}
            </div>
          </div>
        </div>
      </td>
      <td>
        <span className={statusBadgeClass(u.status)}>
          <span className="platform-pill-dot" />
          {u.status}
        </span>
      </td>
      <td className="text-center">
        {u.isPlatformAdmin ? (
          <span className="platform-pill platform-pill-brand inline-flex items-center gap-1">
            <IconCrown size={12} />
            {t('users.adminBadge')}
          </span>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">—</span>
        )}
      </td>
      <td className="text-right tabular-nums font-medium">{u.workspaceCount}</td>
      <td className="col-hide-mobile text-xs text-[var(--color-text-secondary)]">
        {formatDateTime(u.createdAt, language)}
      </td>
      <td className="text-right">
        <button
          type="button"
          onClick={onGrantCredit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
          title={t('users.creditModal.title', 'Điều chỉnh Credit')}
        >
          <IconCoin size={13} />
          {t('users.creditBtn', 'Credit')}
        </button>
      </td>
    </tr>
  )
}
