import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconEdit, IconHistory, IconPlus } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useCreatePlatformPricing,
  usePlatformPricing,
  usePlatformPricingCoverage,
  usePlatformPricingHistory,
  usePreviewPlatformPricing,
} from '@/hooks/usePlatform'
import { formatDateTime } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type {
  PricingCapability,
  PricingCoverageItem,
  PricingPreview,
  PricingVersion,
  PricingWarning,
} from '@/types/platform'

const CAPABILITIES: PricingCapability[] = ['STT', 'TRANSLATE', 'SUMMARIZE_SCRIPT', 'TTS', 'VISION', 'RENDER']

/** Billing units per video minute — mirrors CreditPricingServiceImpl.UNITS_PER_MINUTE (docs §6.3). */
const UNITS_PER_MINUTE: Record<PricingCapability, number> = {
  STT: 60,
  TRANSLATE: 500,
  SUMMARIZE_SCRIPT: 500,
  TTS: 1000,
  VISION: 1000,
  RENDER: 60,
}

const LARGE_CHANGE_CODE = '2306'

type FormState = {
  capability: PricingCapability
  providerScope: string
  x: string
  y: string
  schedule: boolean
  effectiveFrom: string
  changeReason: string
  confirmLargeChange: boolean
}

function emptyForm(capability: PricingCapability = 'TTS'): FormState {
  return {
    capability,
    providerScope: '',
    x: '',
    y: '',
    schedule: false,
    effectiveFrom: '',
    changeReason: '',
    confirmLargeChange: false,
  }
}

function coefficient(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toFixed(6)
}

function credits(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** A valid coefficient: ≥ 0, < 10000, at most 6 decimals (NUMERIC(10,6)). */
function parseCoefficient(raw: string): number | null {
  const v = raw.trim()
  if (!/^\d{1,4}(\.\d{1,6})?$/.test(v)) return null
  return Number(v)
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback
}

/** Super Admin — versioned credit price table x, y (Credit_Coefficient_Calculation §10). */
export function PlatformPricingPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const pricing = usePlatformPricing()
  const coverage = usePlatformPricingCoverage()
  const createMutation = useCreatePlatformPricing()

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [historyFor, setHistoryFor] = useState<{ capability: PricingCapability; scope: string | null } | null>(null)

  useDocumentTitle(t('pricing.title'))

  const versions = useMemo(() => pricing.data ?? [], [pricing.data])
  const byCapability = useMemo(() => {
    const groups = new Map<PricingCapability, PricingVersion[]>()
    for (const cap of CAPABILITIES) groups.set(cap, [])
    for (const v of versions) groups.get(v.capability)?.push(v)
    for (const list of groups.values()) {
      list.sort(
        (a, b) =>
          (a.providerScope ?? '').localeCompare(b.providerScope ?? '') ||
          a.effectiveFrom.localeCompare(b.effectiveFrom),
      )
    }
    return groups
  }, [versions])

  const gaps = useMemo(
    () => (coverage.data ?? []).filter((c) => c.matchedBy === 'MISSING' || c.matchedBy === 'DEFAULT'),
    [coverage.data],
  )
  const knownScopes = useMemo(
    () => Array.from(new Set((coverage.data ?? []).map((c) => c.pricingScope))).sort(),
    [coverage.data],
  )

  const stats = useMemo(
    () => ({
      active: versions.filter((v) => v.status === 'ACTIVE').length,
      scheduled: versions.filter((v) => v.status === 'SCHEDULED').length,
      missing: (coverage.data ?? []).filter((c) => c.matchedBy === 'MISSING').length,
      fallback: (coverage.data ?? []).filter((c) => c.matchedBy === 'DEFAULT').length,
    }),
    [versions, coverage.data],
  )

  const openForm = (preset?: Partial<FormState>) => {
    setForm({ ...emptyForm(), ...preset })
    setFormError(null)
    setNeedsConfirm(false)
    setFormOpen(true)
  }

  const openChange = (v: PricingVersion) =>
    openForm({
      capability: v.capability,
      providerScope: v.providerScope ?? '',
      x: coefficient(v.infraCoefficientX),
      y: coefficient(v.tokenCoefficientY),
    })

  const x = parseCoefficient(form.x)
  const y = parseCoefficient(form.y)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (x == null || y == null) {
      setFormError(t('pricing.form.coefficientInvalid'))
      return
    }
    if (!form.changeReason.trim()) {
      setFormError(t('pricing.form.reasonRequired'))
      return
    }
    let effectiveFrom: string | undefined
    if (form.schedule) {
      const d = new Date(form.effectiveFrom)
      if (!form.effectiveFrom || Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        setFormError(t('pricing.form.scheduleInvalid'))
        return
      }
      effectiveFrom = d.toISOString()
    }
    try {
      const result = await createMutation.mutateAsync({
        capability: form.capability,
        providerScope: form.providerScope.trim() || null,
        infraCoefficientX: x,
        tokenCoefficientY: y,
        effectiveFrom,
        changeReason: form.changeReason.trim(),
        confirmLargeChange: form.confirmLargeChange || undefined,
      })
      setFormOpen(false)
      void coverage.refetch()
      setNotice(
        result.warnings.length
          ? { tone: 'warn', text: result.warnings.map((w) => t(`pricing.warning.${w}`)).join(' ') }
          : { tone: 'ok', text: t('pricing.saved') },
      )
    } catch (error) {
      if (error instanceof ApiError && error.code === LARGE_CHANGE_CODE) {
        setNeedsConfirm(true)
        setFormError(t('pricing.form.largeChange'))
        return
      }
      setFormError(errorText(error, t('pricing.form.saveError')))
    }
  }

  return (
    <div className="platform-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('pricing.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">{t('pricing.subtitle')}</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={() => openForm()}>
          <IconPlus size={16} />
          {t('pricing.add')}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t('pricing.stats.active')} value={stats.active} />
        <StatCard label={t('pricing.stats.scheduled')} value={stats.scheduled} />
        <StatCard label={t('pricing.stats.fallback')} value={stats.fallback} hint={t('pricing.stats.fallbackHint')} />
        <StatCard label={t('pricing.stats.missing')} value={stats.missing} hint={t('pricing.stats.missingHint')} />
      </div>

      <div className="platform-card mb-6 p-4 text-sm">
        <div className="mb-2 font-semibold">{t('pricing.formula.title')}</div>
        <ul className="space-y-1 text-[var(--color-text-secondary)]">
          <li>
            <span className="font-mono text-[var(--color-text-primary)]">{t('pricing.formula.byok')}</span>
          </li>
          <li>
            <span className="font-mono text-[var(--color-text-primary)]">{t('pricing.formula.platform')}</span>
          </li>
          <li>{t('pricing.formula.versioning')}</li>
          <li>{t('pricing.formula.scope')}</li>
        </ul>
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : notice.tone === 'warn'
                ? 'border-amber-500/30 bg-amber-500/10'
                : 'border-red-500/30 bg-red-500/10 text-[var(--color-error)]'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" className="btn-link text-xs" onClick={() => setNotice(null)}>
            {t('providers.dismiss')}
          </button>
        </div>
      )}

      {gaps.length > 0 && <CoverageGaps items={gaps} onAdd={(c) => openForm({ capability: c.capability, providerScope: c.pricingScope })} />}

      {pricing.isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('pricing.loadError')}{' '}
          <button type="button" className="btn-link" onClick={() => void pricing.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <th>{t('pricing.col.scope')}</th>
                <th className="text-right">x</th>
                <th className="text-right">y</th>
                <th className="col-hide-mobile text-right">{t('pricing.col.platformPerMinute')}</th>
                <th className="col-hide-mobile text-right">{t('pricing.col.byokPerMinute')}</th>
                <th>{t('pricing.col.status')}</th>
                <th className="col-hide-mobile">{t('pricing.col.reason')}</th>
                <th className="text-right">{t('pricing.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pricing.isLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : (
                CAPABILITIES.map((cap) => (
                  <CapabilityRows
                    key={cap}
                    capability={cap}
                    versions={byCapability.get(cap) ?? []}
                    language={language}
                    onChange={openChange}
                    onAdd={() => openForm({ capability: cap })}
                    onHistory={(v) => setHistoryFor({ capability: v.capability, scope: v.providerScope })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{t('pricing.renderHint')}</p>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('pricing.form.title')}
        description={t('pricing.form.description')}
        size="xl"
      >
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('pricing.form.capability')} hint={t(`pricing.unit.${form.capability}`)}>
              <select
                className="input w-full"
                value={form.capability}
                onChange={(e) => setForm({ ...form, capability: e.target.value as PricingCapability })}
              >
                {CAPABILITIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`pricing.capability.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('pricing.form.scope')} hint={t('pricing.form.scopeHint')}>
              <input
                className="input w-full font-mono text-[13px]"
                list="pricing-known-scopes"
                maxLength={100}
                placeholder={t('pricing.defaultScope')}
                value={form.providerScope}
                onChange={(e) => setForm({ ...form, providerScope: e.target.value })}
              />
              <datalist id="pricing-known-scopes">
                {knownScopes.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('pricing.form.x')} hint={t('pricing.form.xHint')}>
              <input
                className="input w-full font-mono tabular-nums"
                inputMode="decimal"
                required
                placeholder="0.000027"
                value={form.x}
                onChange={(e) => setForm({ ...form, x: e.target.value, confirmLargeChange: false })}
              />
            </Field>
            <Field label={t('pricing.form.y')} hint={t('pricing.form.yHint')}>
              <input
                className="input w-full font-mono tabular-nums"
                inputMode="decimal"
                required
                placeholder="0.005850"
                value={form.y}
                onChange={(e) => setForm({ ...form, y: e.target.value, confirmLargeChange: false })}
              />
            </Field>
          </div>

          <PreviewPanel capability={form.capability} scope={form.providerScope} x={x} y={y} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('pricing.form.effective')}>
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={!form.schedule}
                    onChange={() => setForm({ ...form, schedule: false })}
                  />
                  {t('pricing.form.effectiveNow')}
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.schedule}
                    onChange={() => setForm({ ...form, schedule: true })}
                  />
                  {t('pricing.form.effectiveLater')}
                </label>
                {form.schedule && (
                  <input
                    className="input w-full"
                    type="datetime-local"
                    value={form.effectiveFrom}
                    onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                  />
                )}
              </div>
            </Field>
            <Field label={t('pricing.form.reason')} hint={t('pricing.form.reasonHint')}>
              <textarea
                className="input w-full"
                rows={3}
                maxLength={500}
                required
                value={form.changeReason}
                onChange={(e) => setForm({ ...form, changeReason: e.target.value })}
              />
            </Field>
          </div>

          {needsConfirm && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.confirmLargeChange}
                onChange={(e) => setForm({ ...form, confirmLargeChange: e.target.checked })}
              />
              {t('pricing.form.confirmLargeChange')}
            </label>
          )}

          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-[var(--color-error)]">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
              {t('providers.cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={createMutation.isPending || (needsConfirm && !form.confirmLargeChange)}
            >
              {createMutation.isPending ? t('providers.saving') : t('pricing.form.submit')}
            </button>
          </div>
        </form>
      </Modal>

      <HistoryModal target={historyFor} language={language} onClose={() => setHistoryFor(null)} />
    </div>
  )
}

function CapabilityRows({
  capability,
  versions,
  language,
  onChange,
  onAdd,
  onHistory,
}: {
  capability: PricingCapability
  versions: PricingVersion[]
  language: string
  onChange: (v: PricingVersion) => void
  onAdd: () => void
  onHistory: (v: PricingVersion) => void
}) {
  const { t } = useTranslation('platform')
  const units = UNITS_PER_MINUTE[capability]
  return (
    <>
      <tr className="bg-[var(--color-bg-surface-2)]">
        <td colSpan={8}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="font-semibold">{t(`pricing.capability.${capability}`)}</span>
              <span className="ml-2 text-[11px] text-[var(--color-text-tertiary)]">
                {t(`pricing.unit.${capability}`)} · {t('pricing.unitsPerMinute', { count: units })}
              </span>
            </div>
            <button type="button" className="btn-link text-xs" onClick={onAdd}>
              {t('pricing.addForCapability')}
            </button>
          </div>
        </td>
      </tr>
      {versions.length === 0 ? (
        <tr>
          <td colSpan={8} className="py-3 text-[12px] text-[var(--color-text-tertiary)]">
            {t('pricing.noRow')}
          </td>
        </tr>
      ) : (
        versions.map((v) => (
          <tr key={v.id}>
            <td>
              {v.providerScope ? (
                <span className="font-mono text-[12px]">{v.providerScope}</span>
              ) : (
                <span className="platform-action-badge platform-action-slate">{t('pricing.defaultScope')}</span>
              )}
            </td>
            <td className="text-right font-mono tabular-nums">{coefficient(v.infraCoefficientX)}</td>
            <td className="text-right font-mono tabular-nums">{coefficient(v.tokenCoefficientY)}</td>
            <td className="col-hide-mobile text-right tabular-nums">
              {credits((Number(v.infraCoefficientX) + Number(v.tokenCoefficientY)) * units)}
            </td>
            <td className="col-hide-mobile text-right tabular-nums">{credits(Number(v.infraCoefficientX) * units)}</td>
            <td>
              <span
                className={`platform-action-badge ${
                  v.status === 'ACTIVE' ? 'platform-action-success' : 'platform-action-amber'
                }`}
              >
                {t(`pricing.status.${v.status}`)}
              </span>
              <div className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                {v.status === 'SCHEDULED'
                  ? t('pricing.startsAt', { at: formatDateTime(v.effectiveFrom, language) })
                  : v.effectiveTo
                    ? t('pricing.endsAt', { at: formatDateTime(v.effectiveTo, language) })
                    : t('pricing.since', { at: formatDateTime(v.effectiveFrom, language) })}
              </div>
            </td>
            <td className="col-hide-mobile max-w-[220px] truncate text-[var(--color-text-secondary)]" title={v.changeReason ?? ''}>
              {v.changeReason ?? '—'}
            </td>
            <td>
              <div className="flex justify-end gap-1">
                <IconButton label={t('pricing.history')} onClick={() => onHistory(v)}>
                  <IconHistory size={15} />
                </IconButton>
                {!v.effectiveTo && (
                  <IconButton label={t('pricing.change')} onClick={() => onChange(v)}>
                    <IconEdit size={15} />
                  </IconButton>
                )}
              </div>
            </td>
          </tr>
        ))
      )}
    </>
  )
}

function CoverageGaps({ items, onAdd }: { items: PricingCoverageItem[]; onAdd: (c: PricingCoverageItem) => void }) {
  const { t } = useTranslation('platform')
  return (
    <div className="platform-card mb-6 border-amber-500/30 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <IconAlertTriangle size={16} className="text-amber-500" />
        {t('pricing.coverage.title')}
      </div>
      <p className="mb-3 text-xs text-[var(--color-text-secondary)]">{t('pricing.coverage.hint')}</p>
      <ul className="space-y-1.5 text-sm">
        {items.map((c) => (
          <li key={`${c.providerId}-${c.capability}`} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-medium">{c.providerName}</span>
              <span className="mx-1.5 text-[var(--color-text-tertiary)]">·</span>
              {t(`pricing.capability.${c.capability}`)}
              <span className="ml-2 font-mono text-[12px] text-[var(--color-text-tertiary)]">{c.pricingScope}</span>
              <span
                className={`ml-2 platform-action-badge ${
                  c.matchedBy === 'MISSING' ? 'platform-action-danger' : 'platform-action-amber'
                }`}
              >
                {t(`pricing.coverage.${c.matchedBy}`)}
              </span>
            </span>
            <button type="button" className="btn-link text-xs" onClick={() => onAdd(c)}>
              {t('pricing.coverage.addRow')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Debounced server preview: Credit/unit, Credit/minute and job-type impact of the typed x, y. */
function PreviewPanel({
  capability,
  scope,
  x,
  y,
}: {
  capability: PricingCapability
  scope: string
  x: number | null
  y: number | null
}) {
  const { t } = useTranslation('platform')
  const previewMutation = usePreviewPlatformPricing()
  const [preview, setPreview] = useState<PricingPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const requestId = useRef(0)
  const mutate = previewMutation.mutateAsync

  useEffect(() => {
    if (x == null || y == null) {
      setPreview(null)
      return
    }
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      mutate({ capability, providerScope: scope.trim() || null, infraCoefficientX: x, tokenCoefficientY: y })
        .then((res) => {
          if (id !== requestId.current) return
          setPreview(res)
          setFailed(false)
        })
        .catch(() => {
          if (id === requestId.current) setFailed(true)
        })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [capability, scope, x, y, mutate])

  if (x == null || y == null) {
    return <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-3 text-xs text-[var(--color-text-tertiary)]">{t('pricing.preview.empty')}</div>
  }
  if (failed && !preview) {
    return <div className="text-xs text-[var(--color-error)]">{t('pricing.preview.error')}</div>
  }
  if (!preview) {
    return <div className="text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{t('pricing.preview.title')}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          {preview.current
            ? t('pricing.preview.comparedWith', {
                scope: preview.current.providerScope ?? t('pricing.defaultScope'),
              })
            : t('pricing.preview.noCurrent')}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-[var(--color-text-tertiary)]">
              <th className="text-left font-medium">{t('pricing.preview.perMinute', { count: preview.unitsPerMinute })}</th>
              <th className="text-right font-medium">{t('pricing.preview.current')}</th>
              <th className="text-right font-medium">{t('pricing.preview.proposed')}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr>
              <td>{t('pricing.preview.platform')}</td>
              <td className="text-right">{credits(preview.currentRate.platformPerMinute)}</td>
              <td className="text-right font-semibold">{credits(preview.proposedRate.platformPerMinute)}</td>
            </tr>
            <tr>
              <td>{t('pricing.preview.byok')}</td>
              <td className="text-right">{credits(preview.currentRate.byokPerMinute)}</td>
              <td className="text-right font-semibold">{credits(preview.proposedRate.byokPerMinute)}</td>
            </tr>
            <tr className="text-[11px] text-[var(--color-text-tertiary)]">
              <td>{t('pricing.preview.change')}</td>
              <td className="text-right">x {percent(preview.infraChangePercent)}</td>
              <td className="text-right">y {percent(preview.tokenChangePercent)}</td>
            </tr>
          </tbody>
        </table>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-[var(--color-text-tertiary)]">
              <th className="text-left font-medium">{t('pricing.preview.jobType')}</th>
              <th className="text-right font-medium">{t('pricing.preview.current')}</th>
              <th className="text-right font-medium">{t('pricing.preview.proposed')}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {preview.jobEstimates.map((j) => (
              <tr key={j.jobType}>
                <td>{t(`pricing.job.${j.jobType}`)}</td>
                <td className="text-right">{credits(j.currentCreditsPerMinute)}</td>
                <td className="text-right font-semibold">{credits(j.proposedCreditsPerMinute)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">{t('pricing.preview.jobHint')}</p>
      {(preview.largeChange || preview.warnings.length > 0) && (
        <ul className="mt-2 space-y-1 text-xs text-amber-600 dark:text-amber-400">
          {preview.largeChange && <li>{t('pricing.preview.largeChange')}</li>}
          {preview.warnings.map((w: PricingWarning) => (
            <li key={w}>{t(`pricing.warning.${w}`)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function percent(value: number | null) {
  if (value == null) return '—'
  return `${value > 0 ? '+' : ''}${value}%`
}

function HistoryModal({
  target,
  language,
  onClose,
}: {
  target: { capability: PricingCapability; scope: string | null } | null
  language: string
  onClose: () => void
}) {
  const { t } = useTranslation('platform')
  const history = usePlatformPricingHistory(target?.capability, target ? target.scope ?? 'default' : undefined, !!target)
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={
        target
          ? t('pricing.historyTitle', {
              capability: t(`pricing.capability.${target.capability}`),
              scope: target.scope ?? t('pricing.defaultScope'),
            })
          : ''
      }
      size="xl"
    >
      <div className="overflow-x-auto">
        <table className="platform-table">
          <thead>
            <tr>
              <th>{t('pricing.col.effective')}</th>
              <th className="text-right">x</th>
              <th className="text-right">y</th>
              <th>{t('pricing.col.status')}</th>
              <th>{t('pricing.col.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {history.isLoading ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-[var(--color-text-tertiary)]">
                  {t('common.loading')}
                </td>
              </tr>
            ) : (
              (history.data ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap text-[12px]">
                    {formatDateTime(v.effectiveFrom, language)}
                    {' → '}
                    {v.effectiveTo ? formatDateTime(v.effectiveTo, language) : '∞'}
                  </td>
                  <td className="text-right font-mono tabular-nums">{coefficient(v.infraCoefficientX)}</td>
                  <td className="text-right font-mono tabular-nums">{coefficient(v.tokenCoefficientY)}</td>
                  <td>
                    <span className="platform-action-badge platform-action-slate">{t(`pricing.status.${v.status}`)}</span>
                  </td>
                  <td className="text-[var(--color-text-secondary)]">{v.changeReason ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]"
    >
      {children}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{hint}</div>}
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="platform-card p-4">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{hint}</div>}
    </div>
  )
}
