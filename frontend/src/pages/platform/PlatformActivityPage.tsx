import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconSearch, IconX } from '@tabler/icons-react'
import { PlatformPagination } from '@/components/platform/PlatformPagination'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformActivityLogs } from '@/hooks/usePlatform'
import { formatDateTime } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'

function statusClass(code: number) {
  if (code >= 200 && code < 300) return 'font-semibold tabular-nums platform-code-ok'
  if (code >= 400 && code < 500) return 'font-semibold tabular-nums platform-code-warn'
  return 'font-semibold tabular-nums platform-code-err'
}

/**
 * Regular-user activity: data-changing requests and failed logins (reads are not logged).
 * `?userId=` narrows to one user, e.g. when opened from the credit monitor.
 */
export function PlatformActivityPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [searchParams, setSearchParams] = useSearchParams()
  const userId = searchParams.get('userId') || undefined
  const userLabel = searchParams.get('user') || userId
  const [q, setQ] = useState('')
  const [qApplied, setQApplied] = useState('')
  const [failedOnly, setFailedOnly] = useState(false)
  const [page, setPage] = useState(0)

  useDocumentTitle(t('activity.title'))

  const { data, isLoading, isError, refetch } = usePlatformActivityLogs({
    userId,
    q: qApplied || undefined,
    failedOnly,
    page,
    size: 20,
  })

  return (
    <div className="platform-content">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('activity.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-secondary)]">{t('activity.subtitle')}</p>
      </div>

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('activity.error')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
          {userId && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-xs text-[var(--color-accent)]">
              {t('activity.userFilter', { user: userLabel })}
              <button
                type="button"
                aria-label={t('common.clear')}
                onClick={() => {
                  setSearchParams({})
                  setPage(0)
                }}
              >
                <IconX size={12} />
              </button>
            </span>
          )}
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <IconSearch
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            />
            <input
              className="input w-full !pl-9"
              placeholder={t('activity.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(0)
                  setQApplied(q.trim())
                }
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={failedOnly}
              onChange={(e) => {
                setFailedOnly(e.target.checked)
                setPage(0)
              }}
            />
            {t('activity.failedOnly')}
          </label>
          <span className="ml-auto text-xs tabular-nums text-[var(--color-text-tertiary)]">
            {data ? t('pagination.total', { count: data.totalElements }) : '—'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <th>{t('activity.columns.time')}</th>
                <th>{t('activity.columns.user')}</th>
                <th>{t('activity.columns.action')}</th>
                <th>{t('activity.columns.status')}</th>
                <th className="col-hide-mobile">{t('activity.columns.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !data?.content.length ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('activity.empty')}
                  </td>
                </tr>
              ) : (
                data.content.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-[var(--color-text-secondary)]">
                      {formatDateTime(row.createdAt, language)}
                    </td>
                    <td className="text-[12px]">
                      {row.userEmail ?? (row.userId ? row.userId : (
                        <span className="text-[var(--color-text-tertiary)]">{t('activity.anonymous')}</span>
                      ))}
                    </td>
                    <td className="font-mono text-[12px]" title={row.path}>{row.action}</td>
                    <td className={statusClass(row.statusCode)}>{row.statusCode}</td>
                    <td className="col-hide-mobile font-mono text-[12px] text-[var(--color-text-secondary)]" title={row.userAgent ?? undefined}>
                      {row.ip ?? '—'}
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
    </div>
  )
}
