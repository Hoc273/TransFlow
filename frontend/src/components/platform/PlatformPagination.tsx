import { useTranslation } from 'react-i18next'

type Props = {
  page: number
  totalPages: number
  totalElements: number
  onPageChange: (page: number) => void
}

export function PlatformPagination({ page, totalPages, totalElements, onPageChange }: Props) {
  const { t } = useTranslation('platform')
  if (totalPages <= 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]">
      <span>
        {t('pagination.page', { page: page + 1, total: Math.max(totalPages, 1) })} ·{' '}
        {t('pagination.total', { count: totalElements })}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary text-xs py-1.5 px-2.5"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          {t('pagination.prev')}
        </button>
        <button
          type="button"
          className="btn-secondary text-xs py-1.5 px-2.5"
          disabled={page + 1 >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  )
}
