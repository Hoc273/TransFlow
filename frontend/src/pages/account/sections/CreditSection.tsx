import { useMemo, useState } from 'react'
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCheck,
  IconCoins,
  IconCreditCard,
  IconLoader2,
  IconRefresh,
  IconReceipt,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/shared/Modal'
import {
  useCreditPackages,
  useCreditTransactions,
  usePurchaseCreditPackage,
  useUserCredit,
} from '@/hooks/useCredit'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { CreditPackage, CreditTransactionType } from '@/types/credit'

const PAGE_SIZE = 10

export function CreditSection() {
  const { t } = useTranslation(['account', 'common'])
  const language = useUiStore((state) => state.language)
  const [page, setPage] = useState(0)
  const [type, setType] = useState<CreditTransactionType | ''>('')
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null)

  const balance = useUserCredit()
  const transactions = useCreditTransactions({
    page,
    size: PAGE_SIZE,
    type: type || undefined,
  })
  const packages = useCreditPackages()

  const balanceValue = Number(balance.data?.balance ?? 0)
  const error = balance.error ?? transactions.error ?? packages.error

  const refresh = () => {
    void balance.refetch()
    void transactions.refetch()
    void packages.refetch()
  }

  return (
    <div className="space-y-6">
      {purchaseMessage && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-500"
        >
          <IconCheck size={16} className="shrink-0" />
          <span>{purchaseMessage}</span>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xs">
        <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,.6fr)] md:p-8">
          <div className="min-w-0">
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <IconCoins size={21} />
            </div>
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">
              {t('account:credit.available')}
            </p>
            <div className="mt-1 flex min-h-12 items-baseline gap-2">
              {balance.isLoading ? (
                <IconLoader2 size={28} className="animate-spin text-[var(--color-accent)]" />
              ) : (
                <>
                  <strong className="text-4xl font-semibold tracking-[-0.04em] text-[var(--color-text-primary)] sm:text-5xl">
                    {formatNumber(balanceValue, language)}
                  </strong>
                  <span className="text-sm text-[var(--color-text-tertiary)]">
                    {t('account:credit.unit')}
                  </span>
                </>
              )}
            </div>
            <p className="mt-3 max-w-xl text-xs leading-5 text-[var(--color-text-secondary)]">
              {t('account:credit.balanceHelp')}
            </p>
          </div>

          <div className="flex flex-col justify-between gap-5 border-t border-[var(--color-border)] pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('account:credit.addTitle')}
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                {t('account:credit.addDesc')}
              </p>
            </div>
            <button
              type="button"
              className="btn-primary flex items-center justify-center gap-2 self-start"
              onClick={() => setPurchaseOpen(true)}
            >
              <IconCreditCard size={16} />
              {t('account:credit.buy')}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-error)]/25 bg-[var(--color-error-bg)] p-4 text-xs text-[var(--color-error)]">
          <span>{error instanceof ApiError ? error.message : t('common:error.loadFailed')}</span>
          <button type="button" className="btn-secondary btn-sm" onClick={refresh}>
            {t('common:retry')}
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xs">
        <div className="flex flex-col gap-4 border-b border-[var(--color-border)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <IconReceipt size={16} className="text-[var(--color-accent)]" />
              {t('account:credit.history')}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {t('account:credit.historyDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="field-input min-w-40 text-xs"
              aria-label={t('account:credit.filterLabel')}
              value={type}
              onChange={(event) => {
                setType(event.target.value as CreditTransactionType | '')
                setPage(0)
              }}
            >
              <option value="">{t('account:credit.allTypes')}</option>
              <option value="PACKAGE_PURCHASE">{t('account:credit.types.PACKAGE_PURCHASE')}</option>
              <option value="AI_USAGE">{t('account:credit.types.AI_USAGE')}</option>
              <option value="INITIAL_GRANT">{t('account:credit.types.INITIAL_GRANT')}</option>
              <option value="ADJUSTMENT">{t('account:credit.types.ADJUSTMENT')}</option>
            </select>
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-label={t('common:refresh')}
              disabled={transactions.isFetching}
              onClick={() => void transactions.refetch()}
            >
              <IconRefresh size={15} className={transactions.isFetching ? 'animate-spin' : undefined} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="dd-table w-full">
            <thead>
              <tr>
                <th>{t('account:credit.columns.transaction')}</th>
                <th>{t('account:credit.columns.date')}</th>
                <th className="text-right">{t('account:credit.columns.amount')}</th>
                <th className="text-right">{t('account:credit.columns.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.isLoading ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    <IconLoader2 size={20} className="mx-auto animate-spin" />
                  </td>
                </tr>
              ) : transactions.data?.items.length ? (
                transactions.data.items.map((transaction) => {
                  const amount = Number(transaction.amount)
                  const positive = amount >= 0
                  return (
                    <tr key={transaction.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              positive
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {positive ? <IconArrowDownRight size={16} /> : <IconArrowUpRight size={16} />}
                          </span>
                          <div>
                            <div className="text-xs font-medium text-[var(--color-text-primary)]">
                              {t(`account:credit.types.${transaction.type}`)}
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                              {transaction.refType || t('account:credit.noReference')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">
                        {formatDateTime(transaction.createdAt, language)}
                      </td>
                      <td className={`num text-right font-semibold ${positive ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {positive ? '+' : ''}{formatNumber(amount, language)}
                      </td>
                      <td className="num text-right text-[var(--color-text-primary)]">
                        {formatNumber(Number(transaction.balanceAfter), language)}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-xs text-[var(--color-text-tertiary)]">
                    {t('account:credit.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {(transactions.data?.totalPages ?? 0) > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-secondary)]">
            <span>
              {t('account:credit.page', {
                current: page + 1,
                total: transactions.data?.totalPages ?? 1,
              })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                {t('common:previous')}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={page + 1 >= (transactions.data?.totalPages ?? 1)}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common:next')}
              </button>
            </div>
          </div>
        )}
      </section>

      <PurchaseCreditModal
        open={purchaseOpen}
        packages={packages.data ?? []}
        loading={packages.isLoading}
        language={language}
        onClose={() => setPurchaseOpen(false)}
        onPurchased={(newBalance) => {
          setPurchaseOpen(false)
          setPurchaseMessage(
            t('account:credit.purchaseSuccess', {
              balance: formatNumber(newBalance, language),
            }),
          )
        }}
      />
    </div>
  )
}

function PurchaseCreditModal({
  open,
  packages,
  loading,
  language,
  onClose,
  onPurchased,
}: {
  open: boolean
  packages: CreditPackage[]
  loading: boolean
  language: string
  onClose: () => void
  onPurchased: (newBalance: number) => void
}) {
  const { t } = useTranslation(['account', 'common'])
  const purchase = usePurchaseCreditPackage()
  const [selectedId, setSelectedId] = useState('')
  const [paymentReference, setPaymentReference] = useState('')

  const selected = useMemo(
    () => packages.find((creditPackage) => creditPackage.id === selectedId) ?? null,
    [packages, selectedId],
  )

  const close = () => {
    if (purchase.isPending) return
    purchase.reset()
    setSelectedId('')
    setPaymentReference('')
    onClose()
  }

  const submit = async () => {
    if (!selected || !paymentReference.trim()) return
    try {
      const result = await purchase.mutateAsync({
        packageId: selected.id,
        paymentReference: paymentReference.trim(),
      })
      onPurchased(Number(result.newBalance))
      purchase.reset()
      setSelectedId('')
      setPaymentReference('')
    } catch {
      // The mutation error is rendered below.
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('account:credit.modal.title')}
      description={t('account:credit.modal.desc')}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" disabled={purchase.isPending} onClick={close}>
            {t('account:common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            disabled={!selected || !paymentReference.trim() || purchase.isPending}
            onClick={() => void submit()}
          >
            {purchase.isPending && <IconLoader2 size={15} className="animate-spin" />}
            {t('account:credit.modal.confirm')}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="py-10 text-center text-[var(--color-text-tertiary)]">
          <IconLoader2 size={22} className="mx-auto animate-spin" />
        </div>
      ) : packages.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {packages.map((creditPackage) => {
            const active = creditPackage.id === selectedId
            return (
              <button
                key={creditPackage.id}
                type="button"
                aria-pressed={active}
                className={`relative rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-bg-surface-2)] hover:border-[var(--color-border-strong)]'
                }`}
                onClick={() => setSelectedId(creditPackage.id)}
              >
                {active && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-white">
                    <IconCheck size={12} />
                  </span>
                )}
                <div className="pr-7 text-sm font-semibold text-[var(--color-text-primary)]">
                  {creditPackage.name}
                </div>
                <div className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)]">
                  {formatNumber(Number(creditPackage.creditAmount), language)}
                </div>
                <div className="text-[11px] text-[var(--color-text-tertiary)]">
                  {t('account:credit.unit')}
                </div>
                <div className="mt-4 text-xs font-medium text-[var(--color-accent)]">
                  {new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
                    style: 'currency',
                    currency: creditPackage.priceCurrency,
                  }).format(Number(creditPackage.priceAmount))}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="py-8 text-center text-xs text-[var(--color-text-tertiary)]">
          {t('account:credit.modal.noPackages')}
        </p>
      )}

      <div className="mt-5 space-y-1.5">
        <label htmlFor="credit-payment-reference" className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t('account:credit.modal.reference')}
        </label>
        <input
          id="credit-payment-reference"
          className="field-input w-full"
          value={paymentReference}
          disabled={purchase.isPending}
          placeholder={t('account:credit.modal.referencePlaceholder')}
          onChange={(event) => setPaymentReference(event.target.value)}
        />
        <p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">
          {t('account:credit.modal.referenceHelp')}
        </p>
      </div>

      {purchase.isError && (
        <p role="alert" className="mt-4 rounded-lg bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error)]">
          {purchase.error instanceof ApiError ? purchase.error.message : t('account:credit.modal.error')}
        </p>
      )}
    </Modal>
  )
}
