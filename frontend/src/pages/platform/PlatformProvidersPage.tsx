import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconEdit,
  IconMicrophone,
  IconPlayerPlay,
  IconPlus,
  IconPower,
  IconTrash,
} from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useCreatePlatformProvider,
  useDeletePlatformProvider,
  usePlatformProviders,
  useSyncPlatformProviderVoices,
  useTestPlatformProvider,
  useUpdatePlatformProvider,
} from '@/hooks/usePlatform'
import { formatDateTime } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type {
  PlatformProvider,
  PlatformProviderInput,
  PlatformProviderTier,
  ProviderTestResult,
} from '@/types/platform'

const PROTOCOLS = [
  'openai_compatible',
  'anthropic',
  'elevenlabs_native',
  'azure_speech',
  'google_speech',
  'dashscope_native',
] as const
const CAPABILITIES = ['STT', 'TRANSLATE', 'TTS', 'VISION'] as const

type FormState = {
  name: string
  protocol: string
  capabilities: string[]
  baseUrl: string
  apiKey: string
  defaultModel: string
  priority: string
  weight: string
  tier: PlatformProviderTier
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  protocol: 'openai_compatible',
  capabilities: ['TRANSLATE'],
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  priority: '100',
  weight: '1',
  tier: 'PAID',
  isActive: true,
}

function toForm(p: PlatformProvider): FormState {
  return {
    name: p.name,
    protocol: p.protocol,
    capabilities: p.capabilities,
    baseUrl: p.baseUrl,
    apiKey: '',
    defaultModel: p.defaultModel ?? '',
    priority: String(p.priority),
    weight: String(p.weight),
    tier: p.tier,
    isActive: p.isActive,
  }
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback
}

/** Super Admin — shared platform AI key pool used by every user without a personal key. */
export function PlatformProvidersPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const { data, isLoading, isError, refetch } = usePlatformProviders()
  const createMutation = useCreatePlatformProvider()
  const updateMutation = useUpdatePlatformProvider()
  const deleteMutation = useDeletePlatformProvider()
  const testMutation = useTestPlatformProvider()
  const syncMutation = useSyncPlatformProviderVoices()

  const [editing, setEditing] = useState<PlatformProvider | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ provider: PlatformProvider; result: ProviderTestResult } | null>(
    null,
  )
  const [confirmDelete, setConfirmDelete] = useState<PlatformProvider | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useDocumentTitle(t('providers.title'))

  const providers = useMemo(() => data ?? [], [data])
  const stats = useMemo(() => {
    const active = providers.filter((p) => p.isActive)
    return {
      active: active.length,
      healthy: active.filter((p) => p.healthStatus === 'HEALTHY' && !p.coolingDown).length,
      down: active.filter((p) => p.healthStatus === 'DOWN').length,
      cooling: active.filter((p) => p.coolingDown).length,
    }
  }, [providers])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (p: PlatformProvider) => {
    setForm(toForm(p))
    setFormError(null)
    setEditing(p)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!form.capabilities.length) {
      setFormError(t('providers.form.capabilitiesRequired'))
      return
    }
    const body: PlatformProviderInput = {
      name: form.name.trim(),
      protocol: form.protocol,
      capabilities: form.capabilities,
      baseUrl: form.baseUrl.trim(),
      defaultModel: form.defaultModel.trim(),
      priority: Number(form.priority),
      weight: Number(form.weight),
      tier: form.tier,
      isActive: form.isActive,
    }
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim()
    try {
      if (editing === 'new') {
        await createMutation.mutateAsync(body)
      } else if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, body })
      }
      setEditing(null)
    } catch (error) {
      setFormError(errorText(error, t('providers.form.saveError')))
    }
  }

  const runTest = async (p: PlatformProvider) => {
    setBusyId(p.id)
    try {
      const result = await testMutation.mutateAsync(p.id)
      setTestResult({ provider: p, result })
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, t('providers.testError')) })
    } finally {
      setBusyId(null)
    }
  }

  const runSync = async (p: PlatformProvider) => {
    setBusyId(p.id)
    try {
      const res = await syncMutation.mutateAsync(p.id)
      setNotice({ tone: 'ok', text: t('providers.syncDone', { name: p.name, count: res.activeVoices }) })
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, t('providers.syncError')) })
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (p: PlatformProvider) => {
    setBusyId(p.id)
    try {
      await updateMutation.mutateAsync({ id: p.id, body: { isActive: !p.isActive } })
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, t('providers.form.saveError')) })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    try {
      await deleteMutation.mutateAsync(confirmDelete.id)
      setConfirmDelete(null)
    } catch (error) {
      setConfirmDelete(null)
      setNotice({ tone: 'error', text: errorText(error, t('providers.deleteError')) })
    }
  }

  const toggleCapability = (cap: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap)
        ? f.capabilities.filter((c) => c !== cap)
        : [...f.capabilities, cap],
    }))
  }

  const saving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="platform-content">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('providers.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">{t('providers.subtitle')}</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" onClick={openCreate}>
          <IconPlus size={16} />
          {t('providers.add')}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t('providers.stats.active')} value={stats.active} />
        <StatCard label={t('providers.stats.healthy')} value={stats.healthy} />
        <StatCard label={t('providers.stats.cooling')} value={stats.cooling} hint={t('providers.stats.coolingHint')} />
        <StatCard label={t('providers.stats.down')} value={stats.down} hint={t('providers.stats.downHint')} />
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
            notice.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-red-500/30 bg-red-500/10 text-[var(--color-error)]'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" className="btn-link text-xs" onClick={() => setNotice(null)}>
            {t('providers.dismiss')}
          </button>
        </div>
      )}

      {isError && (
        <div className="mb-3 text-sm text-[var(--color-error)]">
          {t('providers.loadError')}{' '}
          <button type="button" className="btn-link" onClick={() => void refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="platform-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="platform-table">
            <thead>
              <tr>
                <th>{t('providers.col.name')}</th>
                <th>{t('providers.col.capabilities')}</th>
                <th className="col-hide-mobile">{t('providers.col.model')}</th>
                <th className="text-right">{t('providers.col.priority')}</th>
                <th>{t('providers.col.health')}</th>
                <th className="col-hide-mobile">{t('providers.col.lastChecked')}</th>
                <th className="text-right">{t('providers.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : !providers.length ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--color-text-tertiary)]">
                    {t('providers.empty')}
                  </td>
                </tr>
              ) : (
                providers.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'opacity-50'}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <span
                          className={`platform-action-badge ${
                            p.tier === 'FREE' ? 'platform-action-success' : 'platform-action-slate'
                          }`}
                        >
                          {t(`providers.tier.${p.tier}`)}
                        </span>
                        {!p.isActive && (
                          <span className="platform-action-badge platform-action-slate">
                            {t('providers.inactive')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                        {p.protocol} · {p.apiKeyHint ?? '****'}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.capabilities.map((c) => (
                          <span key={c} className="platform-action-badge platform-action-slate">
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="col-hide-mobile font-mono text-[12px] text-[var(--color-text-secondary)]">
                      {p.defaultModel ?? '—'}
                    </td>
                    <td className="text-right tabular-nums">
                      {p.priority}
                      <span className="text-[var(--color-text-tertiary)]"> · ×{p.weight}</span>
                    </td>
                    <td>
                      <HealthBadge provider={p} label={healthLabel(p, t)} />
                    </td>
                    <td className="col-hide-mobile text-[var(--color-text-secondary)]">
                      {p.lastCheckedAt ? formatDateTime(p.lastCheckedAt, language) : '—'}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label={t('providers.test')}
                          disabled={busyId === p.id}
                          onClick={() => void runTest(p)}
                        >
                          <IconPlayerPlay size={15} />
                        </IconButton>
                        {p.capabilities.includes('TTS') && (
                          <IconButton
                            label={t('providers.syncVoices')}
                            disabled={busyId === p.id}
                            onClick={() => void runSync(p)}
                          >
                            <IconMicrophone size={15} />
                          </IconButton>
                        )}
                        <IconButton label={t('providers.edit')} onClick={() => openEdit(p)}>
                          <IconEdit size={15} />
                        </IconButton>
                        <IconButton
                          label={p.isActive ? t('providers.deactivate') : t('providers.activate')}
                          disabled={busyId === p.id}
                          onClick={() => void toggleActive(p)}
                        >
                          <IconPower size={15} />
                        </IconButton>
                        <IconButton label={t('providers.delete')} danger onClick={() => setConfirmDelete(p)}>
                          <IconTrash size={15} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{t('providers.poolHint')}</p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('providers.form.createTitle') : t('providers.form.editTitle')}
        size="lg"
      >
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('providers.form.name')}>
              <input
                className="input w-full"
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('providers.form.protocol')}>
              <select
                className="input w-full"
                value={form.protocol}
                disabled={editing !== 'new'}
                onChange={(e) => setForm({ ...form, protocol: e.target.value })}
              >
                {PROTOCOLS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={t('providers.form.baseUrl')} hint={t('providers.form.baseUrlHint')}>
            <input
              className="input w-full font-mono text-[13px]"
              required
              maxLength={500}
              placeholder="https://api.openai.com/v1"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={t('providers.form.apiKey')}
              hint={editing === 'new' ? undefined : t('providers.form.apiKeyKeep')}
            >
              <input
                className="input w-full font-mono text-[13px]"
                type="password"
                autoComplete="off"
                required={editing === 'new'}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
            </Field>
            <Field label={t('providers.form.model')}>
              <input
                className="input w-full font-mono text-[13px]"
                required
                maxLength={200}
                placeholder="gpt-4o-mini"
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
              />
            </Field>
          </div>

          <Field label={t('providers.form.capabilities')}>
            <div className="flex flex-wrap gap-3">
              {CAPABILITIES.map((c) => (
                <label key={c} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.capabilities.includes(c)}
                    onChange={() => toggleCapability(c)}
                  />
                  {c}
                </label>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('providers.form.priority')} hint={t('providers.form.priorityHint')}>
              <input
                className="input w-full"
                type="number"
                min={0}
                max={1000}
                required
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              />
            </Field>
            <Field label={t('providers.form.weight')} hint={t('providers.form.weightHint')}>
              <input
                className="input w-full"
                type="number"
                min={1}
                max={100}
                required
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
              />
            </Field>
            <Field label={t('providers.form.tier')}>
              <select
                className="input w-full"
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value as PlatformProviderTier })}
              >
                <option value="PAID">{t('providers.tier.PAID')}</option>
                <option value="FREE">{t('providers.tier.FREE')}</option>
              </select>
            </Field>
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t('providers.form.active')}
          </label>

          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-[var(--color-error)]">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
              {t('providers.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('providers.saving') : t('providers.save')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!testResult}
        onClose={() => setTestResult(null)}
        title={testResult ? t('providers.testTitle', { name: testResult.provider.name }) : ''}
        description={testResult?.result.message}
      >
        {testResult && (
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span>{t('providers.testAuth')}</span>
              <ResultPill ok={testResult.result.authSuccess} />
            </li>
            {testResult.result.capabilityResults.map((r) => (
              <li key={r.capability} className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{r.capability}</div>
                  {!r.success && (r.errorCode || r.message) && (
                    <div className="text-xs text-[var(--color-text-tertiary)]">
                      {[r.errorCode, r.message].filter(Boolean).join(' — ')}
                    </div>
                  )}
                </div>
                <ResultPill ok={r.success} />
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t('providers.deleteTitle')}
        description={confirmDelete ? t('providers.deleteBody', { name: confirmDelete.name }) : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)}>
              {t('providers.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary !bg-[var(--color-error)]"
              disabled={deleteMutation.isPending}
              onClick={() => void remove()}
            >
              {t('providers.delete')}
            </button>
          </div>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">{t('providers.deleteHint')}</p>
      </Modal>
    </div>
  )
}

function healthLabel(p: PlatformProvider, t: (key: string) => string) {
  if (p.coolingDown) return t('providers.health.COOLING')
  return t(`providers.health.${p.healthStatus}`)
}

function HealthBadge({ provider, label }: { provider: PlatformProvider; label: string }) {
  const dot = provider.coolingDown
    ? 'platform-dot-warning'
    : provider.healthStatus === 'HEALTHY'
      ? 'platform-dot-success'
      : provider.healthStatus === 'DOWN'
        ? 'platform-dot-destructive'
        : 'platform-dot-muted'
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 text-sm">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      {provider.lastErrorCode && (
        <div className="mt-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{provider.lastErrorCode}</div>
      )}
    </div>
  )
}

function ResultPill({ ok }: { ok: boolean }) {
  return (
    <span className={`platform-action-badge ${ok ? 'platform-action-success' : 'platform-action-danger'}`}>
      {ok ? 'OK' : 'FAIL'}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${
        danger
          ? 'text-[var(--color-text-tertiary)] hover:bg-red-500/10 hover:text-[var(--color-error)]'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]'
      }`}
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
