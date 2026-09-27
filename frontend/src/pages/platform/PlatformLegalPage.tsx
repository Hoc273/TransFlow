import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconExternalLink, IconScale, IconShieldLock } from '@tabler/icons-react'
import { useAdminLegalDocuments, useUpdateLegalDocument } from '@/hooks/useGuide'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ApiError } from '@/types/api'
import type { LegalDocument, LegalDocumentRequest, LegalDocumentType } from '@/types/guide'
import { cn } from '@/lib/cn'

const TABS: Array<{ type: LegalDocumentType; key: 'terms' | 'privacy'; Icon: typeof IconScale }> = [
  { type: 'TERMS', key: 'terms', Icon: IconScale },
  { type: 'PRIVACY', key: 'privacy', Icon: IconShieldLock },
]

const EMPTY: LegalDocumentRequest = { titleVi: '', titleEn: '', contentVi: '', contentEn: '' }

function toForm(doc: LegalDocument | undefined): LegalDocumentRequest {
  if (!doc) return EMPTY
  return {
    titleVi: doc.titleVi ?? '',
    titleEn: doc.titleEn ?? '',
    contentVi: doc.contentVi ?? '',
    contentEn: doc.contentEn ?? '',
  }
}

/** Platform Super Admin editor for Terms of Service / Privacy Policy (shown under /guide). */
export function PlatformLegalPage() {
  const { t } = useTranslation(['platform', 'common'])
  useDocumentTitle(t('platform:legal.title'))
  const docs = useAdminLegalDocuments()
  const update = useUpdateLegalDocument()

  const [active, setActive] = useState<LegalDocumentType>('TERMS')
  const [form, setForm] = useState<LegalDocumentRequest>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const current = docs.data?.find((d) => d.type === active)

  useEffect(() => {
    setForm(toForm(current))
    setError(null)
    setSaved(false)
  }, [current])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSaved(false)
    if (!form.titleVi.trim() || !form.titleEn.trim() || !form.contentVi.trim() || !form.contentEn.trim()) {
      setError(t('platform:legal.required'))
      return
    }
    setError(null)
    update.mutate(
      { type: active, body: form },
      {
        onSuccess: () => setSaved(true),
        onError: (err) =>
          setError(err instanceof ApiError && err.message ? err.message : t('common:error.generic')),
      },
    )
  }

  const activeTab = TABS.find((tab) => tab.type === active)!

  return (
    <div className="platform-content">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('platform:legal.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
            {t('platform:legal.subtitle')}
          </p>
        </div>
        <Link
          to={`/guide/legal/${activeTab.key}`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary inline-flex items-center gap-1.5"
        >
          <IconExternalLink size={16} />
          {t('platform:legal.viewPublic')}
        </Link>
      </div>

      <div className="mb-4 flex gap-2 border-b border-[var(--color-border)]">
        {TABS.map(({ type, key, Icon }) => (
          <button
            key={type}
            type="button"
            onClick={() => setActive(type)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors',
              active === type
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
            )}
          >
            <Icon size={16} />
            {t(`platform:legal.${key}`)}
          </button>
        ))}
      </div>

      {docs.isLoading ? (
        <div className="platform-card p-8 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common:loading')}
        </div>
      ) : docs.isError ? (
        <div className="platform-card p-6 text-sm text-[var(--color-error)]">
          {t('common:error.loadFailed')}{' '}
          <button type="button" className="btn-link" onClick={() => void docs.refetch()}>
            {t('common:retry')}
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="platform-card space-y-4 p-5" data-testid="legal-form">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <label className="block space-y-1 text-sm font-medium">
              <span>{t('platform:legal.titleVi')}</span>
              <input
                className="input w-full"
                maxLength={300}
                value={form.titleVi}
                onChange={(e) => setForm({ ...form, titleVi: e.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{t('platform:legal.titleEn')}</span>
              <input
                className="input w-full"
                maxLength={300}
                value={form.titleEn}
                onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{t('platform:legal.contentVi')}</span>
              <textarea
                className="input w-full font-mono text-[13px]"
                rows={22}
                value={form.contentVi}
                onChange={(e) => setForm({ ...form, contentVi: e.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{t('platform:legal.contentEn')}</span>
              <textarea
                className="input w-full font-mono text-[13px]"
                rows={22}
                value={form.contentEn}
                onChange={(e) => setForm({ ...form, contentEn: e.target.value })}
              />
            </label>
          </div>

          {error && <div className="text-sm text-[var(--color-error)]">{error}</div>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {current?.updatedAt &&
                `${t('platform:legal.updatedAt')}: ${new Date(current.updatedAt).toLocaleString()}`}
            </span>
            <div className="flex items-center gap-3">
              {saved && <span className="text-sm text-[var(--color-success)]">{t('platform:legal.saved')}</span>}
              <button type="submit" className="btn-primary" disabled={update.isPending}>
                {update.isPending ? t('platform:legal.saving') : t('platform:legal.save')}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
