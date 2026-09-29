import { useState } from 'react'
import { IconAlertTriangle, IconCoin } from '@tabler/icons-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import type { CostMode } from '@/api/workspaces'
import { usePermission } from '@/hooks/usePermission'
import {
  useUpdateWorkspaceBillingConfig,
  useWorkspaceBillingConfig,
} from '@/hooks/useWorkspaceBilling'
import { ApiError } from '@/types/api'

const COST_MODES: CostMode[] = ['PAY_PER_USER', 'LEAD_PAYS_ALL']

/**
 * Workspace cost mode (SRS §5.6, Arch §10.3) — decides whose credit is charged for
 * AI usage. GET for every member, PUT gated to LEAD (BE requireLead is the real gate).
 */
export function WorkspaceBillingCard({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation(['settings', 'common'])
  const canManage = usePermission('workspace.manage_billing')
  const { data, isLoading, isError } = useWorkspaceBillingConfig(workspaceId)
  const update = useUpdateWorkspaceBillingConfig(workspaceId)
  const [error, setError] = useState<string | null>(null)

  const current = data?.costMode ?? 'PAY_PER_USER'

  const onSelect = (next: CostMode) => {
    setError(null)
    if (!canManage || next === current || update.isPending) return
    if (!window.confirm(t(`settings:billing.confirm.${next}`))) return
    update.mutate(next, {
      onError: (err) => setError(err instanceof ApiError ? err.message : t('common:error.generic')),
    })
  }

  return (
    <section className="app-card mb-4">
      <div className="app-card-header">
        <div className="app-card-title">
          <IconCoin size={16} />
          {t('settings:billing.title')}
        </div>
        {!canManage && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {t('settings:billing.leadOnly')}
          </span>
        )}
      </div>

      <div className="app-card-body space-y-3">
        <p className="text-xs text-[var(--color-text-secondary)]">{t('settings:billing.subtitle')}</p>

        {isLoading ? (
          <div className="py-4 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        ) : isError ? (
          <p className="field-error">{t('common:error.loadFailed')}</p>
        ) : (
          <div role="radiogroup" aria-label={t('settings:billing.title')} className="grid gap-2 sm:grid-cols-2">
            {COST_MODES.map((mode) => {
              const selected = mode === current
              return (
                <label
                  key={mode}
                  className={clsx(
                    'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                    selected
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border)]',
                    canManage && !update.isPending
                      ? 'cursor-pointer hover:border-[var(--color-border-strong)]'
                      : 'cursor-default',
                    !canManage && !selected && 'opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name={`cost-mode-${workspaceId}`}
                    className="mt-0.5"
                    value={mode}
                    checked={selected}
                    disabled={!canManage || update.isPending}
                    onChange={() => onSelect(mode)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                      {t(`settings:billing.mode.${mode}.label`)}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">
                      {t(`settings:billing.mode.${mode}.desc`)}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-app)] px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-primary)]">
            <IconAlertTriangle size={14} className="text-[var(--color-severity-medium)]" />
            {t('settings:billing.notes.title')}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--color-text-secondary)]">
            <li>{t('settings:billing.notes.leadBalance')}</li>
            <li>{t('settings:billing.notes.immediate')}</li>
            <li>{t('settings:billing.notes.pricing')}</li>
            <li>{t('settings:billing.notes.history')}</li>
          </ul>
        </div>
      </div>
    </section>
  )
}
