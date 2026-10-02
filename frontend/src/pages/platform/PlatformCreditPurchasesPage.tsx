import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconLoader2, IconX } from '@tabler/icons-react'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { Modal } from '@/components/shared/Modal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformCreditPurchases, useReviewCreditPurchase } from '@/hooks/usePlatform'
import { formatDateTime, formatNumber, intlLocale } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { CreditPurchaseStatus } from '@/types/credit'
import type { PlatformCreditPurchaseItem } from '@/types/platform'

const STATUS_FILTERS: Array<CreditPurchaseStatus | ''> = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'LEGACY_UNVERIFIED',
  '',
]

const STATUS_BADGE: Record<CreditPurchaseStatus, string> = {
  PENDING: 'platform-action-badge platform-action-amber',
  APPROVED: 'platform-action-badge platform-action-success',
  REJECTED: 'platform-action-badge platform-action-danger',
  LEGACY_UNVERIFIED: 'platform-action-badge platform-action-slate',
}

type Review = { purchase: PlatformCreditPurchaseItem; decision: 'approve' | 'reject' }

/**
 * Super Admin review queue for credit package purchases. No payment gateway is connected, so a
 * purchase only adds credit after an admin has matched its payment reference to a real transfer.
 */
export function PlatformCreditPurchasesPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [status, setStatus] = useState<CreditPurchaseStatus | ''>('PENDING')
  const [page, setPage] = useState(0)
  const [review, setReview] = useState<Review | null>(null)
  const [note, setNote] = useState('')
  const reviewMutation = useReviewCreditPurchase()

  useDocumentTitle(t('creditPurchases.title'))

  const { data, isLoading, isError, refetch } = usePlatformCreditPurchases({
    status: status || undefined,
    page,
    size: 20,
  })

  const openReview = (purchase: PlatformCreditPurchaseItem, decision: Review['decision']) => {
    reviewMutation.reset()
    setNote('')
    setReview({ purchase, decision })
  }

  const closeReview = () => {
    if (reviewMutation.isPending) return
    setReview(null)
  }

  const submitReview = async () => {
    if (!review) return
    try {
      await reviewMutation.mutateAsync({
        purchaseId: review.purchase.purchaseId,
        decision: review.decision,
        note: note.trim() || undefined,
      })
      setReview(null)
    } catch {
      // The mutation error is rendered in the modal.
    }
  }

  const price = (item: PlatformCreditPurchaseItem) =>
    item.priceCurrency
      ? new Intl.NumberFormat(intlLocale(language), {
          style: 'currency',
          currency: item.priceCurrency,
        }).format(Number(item.pricePaid))
      : formatNumber(Number(item.pricePaid), language)

  return (
    <div className="platform-content">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('creditPurchases.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-secondary)]">
          {t('creditPurchases.subtitle')}
        </p>
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('creditPurchases.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-4">
          {STATUS_FILTERS.map((value) => (
            <button
              key={value || 'all'}
              type="button"
              className={`${status === value ? 'btn-primary' : 'btn-secondary'} py-1.5 text-xs`}
              onClick={() => {
                setStatus(value)
                setPage(0)
              }}
            >
              {t(`creditPurchases.status.${value || 'ALL'}`)}
            </button>
          ))}
          <span className="ml-auto text-xs tabular-nums text-[var(--color-text-tertiary)]">
            {data ? t('pagination.total', { count: data.totalElements }) : '—'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <th>{t('creditPurchases.columns.user')}</th>
                <th>{t('creditPurchases.columns.package')}</th>
                <th>{t('creditPurchases.columns.reference')}</th>
                <th className="text-right">{t('creditPurchases.columns.price')}</th>
                <th className="col-hide-mobile">{t('creditPurchases.columns.requestedAt')}</th>
                <th>{t('creditPurchases.columns.status')}</th>
                <th className="text-right">{t('creditPurchases.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !data?.content.length ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('creditPurchases.empty')}
                  </td>
                </tr>
              ) : (
                data.content.map((item) => (
                  <tr key={item.purchaseId}>
                    <td>
                      <div className="font-medium">{item.userFullName ?? '—'}</div>
                      <div className="text-[12px] text-[var(--color-text-tertiary)]">{item.userEmail ?? item.userId}</div>
                    </td>
                    <td>
                      <div className="font-medium">{item.packageName ?? '—'}</div>
                      <div className="text-[12px] tabular-nums text-[var(--color-text-tertiary)]">
                        {t('creditPurchases.credits', { formatted: formatNumber(Number(item.creditAmount), language) })}
                      </div>
                    </td>
                    <td className="font-mono text-[12px]">{item.paymentReference}</td>
                    <td className="text-right tabular-nums">{price(item)}</td>
                    <td className="col-hide-mobile text-[var(--color-text-secondary)]">
                      {formatDateTime(item.purchasedAt, language)}
                    </td>
                    <td>
                      <span className={STATUS_BADGE[item.status]}>
                        {t(`creditPurchases.status.${item.status}`)}
                      </span>
                      {item.reviewNote && (
                        <div className="mt-1 max-w-[220px] truncate text-[11px] text-[var(--color-text-tertiary)]" title={item.reviewNote}>
                          {item.reviewNote}
                        </div>
                      )}
                    </td>
                    <td className="text-right">
                      {item.status === 'PENDING' ? (
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            className="btn-primary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs"
                            onClick={() => openReview(item, 'approve')}
                          >
                            <IconCheck size={13} />
                            {t('creditPurchases.approve')}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs"
                            onClick={() => openReview(item, 'reject')}
                          >
                            <IconX size={13} />
                            {t('creditPurchases.reject')}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--color-text-tertiary)]">
                          {item.reviewedAt ? formatDateTime(item.reviewedAt, language) : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
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

      <Modal
        open={!!review}
        onClose={closeReview}
        title={review?.decision === 'approve' ? t('creditPurchases.approveTitle') : t('creditPurchases.rejectTitle')}
        description={
          review
            ? t(
                review.decision === 'approve' ? 'creditPurchases.approveDesc' : 'creditPurchases.rejectDesc',
                {
                  credits: formatNumber(Number(review.purchase.creditAmount), language),
                  user: review.purchase.userEmail ?? review.purchase.userId,
                  reference: review.purchase.paymentReference,
                },
              )
            : undefined
        }
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={reviewMutation.isPending} onClick={closeReview}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              disabled={reviewMutation.isPending}
              onClick={() => void submitReview()}
            >
              {reviewMutation.isPending && <IconLoader2 size={15} className="animate-spin" />}
              {review?.decision === 'approve' ? t('creditPurchases.approve') : t('creditPurchases.reject')}
            </button>
          </>
        }
      >
        <label htmlFor="credit-review-note" className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t('creditPurchases.note')}
        </label>
        <input
          id="credit-review-note"
          className="input mt-1.5 w-full"
          maxLength={255}
          value={note}
          disabled={reviewMutation.isPending}
          placeholder={t('creditPurchases.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
        {reviewMutation.isError && (
          <p role="alert" className="mt-3 text-xs text-[var(--color-error)]">
            {reviewMutation.error instanceof ApiError ? reviewMutation.error.message : t('creditPurchases.reviewError')}
          </p>
        )}
      </Modal>
    </div>
  )
}
