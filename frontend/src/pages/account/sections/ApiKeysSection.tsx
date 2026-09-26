import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  IconAlertCircle,
  IconCircleCheck,
  IconEdit,
  IconKey,
  IconLoader2,
  IconMicrophone2,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconStar,
  IconTrash,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import {
  useCreateProvider,
  useDeleteProvider,
  useProviders,
  useRefreshTtsVoices,
  useSetDefaultProvider,
  useTestProvider,
  useTtsVoiceLanguages,
  useTtsVoices,
  useUpdateProvider,
  useVoicePreview,
} from '@/hooks/useProviders'
import { formatVoiceLanguage, voiceMatchesTargetLang } from '@/lib/media/voiceSelection'
import { validateProviderBaseUrl } from '@/lib/providerBaseUrl'
import {
  SELECTABLE_PROTOCOLS,
  defaultBaseUrlFor,
  defaultModelFor,
  isModelUnused,
  protocolCapabilities,
  protocolSupports,
  supportedSubset,
} from '@/lib/providerProtocols'
import { ApiError } from '@/types/api'
import type { ProviderCapability, ProviderConfig, ProviderProtocol, TestConnectionResponse } from '@/types/provider'

/**
 * Personal BYOK API keys (user-scoped `/users/me/providers`).
 * UI ported from the workspace ProvidersPage, limited to what the user
 * provider backend supports: no presets, display names or 4-phase validation —
 * only CRUD, per-capability default, per-capability test connection and
 * the TTS voice catalog.
 */

/** Capabilities accepted by UserAiProviderServiceImpl (TEXT ↔ backend TRANSLATE). */
const CAPABILITY_SECTIONS: {
  capability: ProviderCapability
  titleKey: string
  subtitleKey: string
}[] = [
  { capability: 'TEXT', titleKey: 'sectionTextTitle', subtitleKey: 'sectionTextSubtitle' },
  { capability: 'STT', titleKey: 'sectionSttTitle', subtitleKey: 'sectionSttSubtitle' },
  { capability: 'TTS', titleKey: 'sectionTtsTitle', subtitleKey: 'sectionTtsSubtitle' },
  { capability: 'VISION', titleKey: 'sectionVisionTitle', subtitleKey: 'sectionVisionSubtitle' },
]

const ALL_CAPABILITIES = CAPABILITY_SECTIONS.map((s) => s.capability)

type FormState = {
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  defaultModel: string
  capabilities: ProviderCapability[]
  enabled: boolean
}

const emptyForm = (capability: ProviderCapability = 'TEXT'): FormState => ({
  protocol: 'openai_compatible',
  baseUrl: defaultBaseUrlFor('openai_compatible'),
  apiKey: '',
  defaultModel: defaultModelFor('openai_compatible', [capability]),
  capabilities: [capability],
  enabled: true,
})

function formFromProvider(p: ProviderConfig): FormState {
  return {
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    apiKey: '',
    defaultModel: p.defaultModel,
    // Legacy rows may hold a capability the adapter cannot run (Anthropic + TTS); the
    // backend now rejects saving those, so the form drops them.
    capabilities: supportedSubset(
      p.protocol,
      p.capabilities.filter((c) => ALL_CAPABILITIES.includes(c)),
    ),
    enabled: p.enabled,
  }
}

function FieldHelp({ children }: { children: ReactNode }) {
  return <p className="field-help">{children}</p>
}

type TestState = {
  status: 'testing' | 'success' | 'failed'
  message?: string | null
  result?: TestConnectionResponse
}

export function ApiKeysSection() {
  const { t } = useTranslation(['account', 'settings', 'common', 'media'])
  const tp = (key: string, options?: Record<string, unknown>) =>
    t(`settings:providers.${key}`, options)

  const { data: providers = [], isLoading, isError, error, refetch } = useProviders()
  const createProvider = useCreateProvider()
  const updateProvider = useUpdateProvider()
  const deleteProvider = useDeleteProvider()
  const testProvider = useTestProvider()
  const refreshTtsVoices = useRefreshTtsVoices(undefined)
  const setDefault = useSetDefaultProvider(undefined)
  const [defaultError, setDefaultError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [baseUrlHint, setBaseUrlHint] = useState<string | null>(null)
  const [testState, setTestState] = useState<Record<string, TestState>>({})

  const [voiceProvider, setVoiceProvider] = useState<ProviderConfig | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState('')
  const voiceQuery = useTtsVoices(voiceProvider?.id)
  const voiceLanguagesQuery = useTtsVoiceLanguages(voiceProvider?.id)
  const voicePreview = useVoicePreview()
  const availableLanguages = voiceLanguagesQuery.data ?? []

  useEffect(() => {
    if (availableLanguages.length === 1 && voiceLanguageFilter === '') {
      setVoiceLanguageFilter(availableLanguages[0].code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableLanguages.length])

  const filteredVoices = useMemo(
    () =>
      voiceLanguageFilter
        ? (voiceQuery.data ?? []).filter((voice) => voiceMatchesTargetLang(voice, voiceLanguageFilter))
        : voiceQuery.data,
    [voiceQuery.data, voiceLanguageFilter],
  )

  const protocolLabel = (protocol: ProviderProtocol) =>
    tp(`types.${protocol}`, { defaultValue: protocol })

  const openCreate = (capability: ProviderCapability) => {
    setEditing(null)
    setForm(emptyForm(capability))
    setFormError(null)
    setBaseUrlHint(null)
    setModalOpen(true)
  }

  const openEdit = (p: ProviderConfig) => {
    setEditing(p)
    setForm(formFromProvider(p))
    setFormError(null)
    setBaseUrlHint(null)
    setModalOpen(true)
  }

  const onBaseUrlBlur = () => {
    const result = validateProviderBaseUrl(form.baseUrl, form.protocol)
    if (result.ok) {
      setForm((f) => ({ ...f, baseUrl: result.value }))
      setBaseUrlHint(null)
      return
    }
    setBaseUrlHint(
      t(result.messageKey, {
        suggestion: result.suggestion,
        defaultValue: result.suggestion ? `Use the API root, e.g. ${result.suggestion}` : 'Invalid base URL',
      }),
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!form.defaultModel.trim()) {
      setFormError(t('account:apiKeys.modelRequired'))
      return
    }
    if (!editing && !form.apiKey.trim()) {
      setFormError(tp('apiKeyRequired'))
      return
    }
    if (form.capabilities.length === 0) {
      setFormError(tp('capabilityRequired'))
      return
    }
    const urlResult = validateProviderBaseUrl(form.baseUrl, form.protocol)
    if (!urlResult.ok) {
      setFormError(
        t(urlResult.messageKey, {
          suggestion: urlResult.suggestion,
          defaultValue: urlResult.suggestion
            ? `Invalid base URL. Suggested: ${urlResult.suggestion}`
            : 'Invalid base URL',
        }),
      )
      return
    }

    const body = {
      displayName: form.defaultModel.trim(),
      protocol: form.protocol,
      baseUrl: urlResult.value,
      apiKey: form.apiKey.trim(),
      defaultModel: form.defaultModel.trim(),
      capabilities: form.capabilities,
      enabled: form.enabled,
      // Keep existing defaults, but never for a capability this key no longer serves.
      defaultForCapabilities: (editing?.defaultFor ?? []).filter((c) => form.capabilities.includes(c)),
    }
    const onError = (err: unknown) =>
      setFormError(err instanceof ApiError ? err.message : t('common:error.generic'))

    if (editing) {
      updateProvider.mutate(
        { providerId: editing.id, body: { ...body, apiKey: body.apiKey || undefined } },
        { onSuccess: () => setModalOpen(false), onError },
      )
    } else {
      createProvider.mutate(body, { onSuccess: () => setModalOpen(false), onError })
    }
  }

  const onTest = (p: ProviderConfig, capability: ProviderCapability) => {
    const testKey = `${p.id}:${capability}`
    setTestState((s) => ({ ...s, [testKey]: { status: 'testing' } }))
    testProvider.mutate(
      { providerId: p.id, capability },
      {
        onSuccess: (res) =>
          setTestState((s) => ({
            ...s,
            [testKey]: { status: res.ok ? 'success' : 'failed', message: res.message, result: res },
          })),
        onError: (err) =>
          setTestState((s) => ({
            ...s,
            [testKey]: {
              status: 'failed',
              message: err instanceof ApiError ? err.message : t('common:error.generic'),
            },
          })),
      },
    )
  }

  const onSetDefault = (p: ProviderConfig, capability: ProviderCapability) => {
    setDefaultError(null)
    setDefault.mutate(
      { providerId: p.id, capability },
      {
        onError: (err) =>
          setDefaultError(err instanceof ApiError ? err.message : t('common:error.generic')),
      },
    )
  }

  const onDelete = (p: ProviderConfig) => {
    const msg =
      p.capabilities.length > 1
        ? tp('confirmDeleteMulti', {
            capCount: String(p.capabilities.length),
            capabilities: p.capabilities.join(', '),
            defaultClause: '',
          })
        : tp('confirmDelete')
    if (!window.confirm(msg)) return
    deleteProvider.mutate(p.id)
  }

  const toggleCapability = (capability: ProviderCapability) => {
    setForm((current) => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((c) => c !== capability)
        : [...current.capabilities, capability],
    }))
  }

  const openVoiceCatalog = (provider: ProviderConfig) => {
    setVoiceProvider(provider)
    setVoiceError(null)
    setVoiceLanguageFilter('')
  }

  const saving = createProvider.isPending || updateProvider.isPending

  const renderSection = (section: (typeof CAPABILITY_SECTIONS)[number]) => {
    const sectionProviders = providers.filter((p) => p.capabilities.includes(section.capability))
    const defaultProvider = sectionProviders.find((p) => p.defaultFor?.includes(section.capability))
    // Mirrors ProviderResolverServiceImpl: >1 active key for a capability without an
    // explicit default fails the stage with PROVIDER_DEFAULT_NOT_CONFIGURED.
    const needsDefault =
      !defaultProvider && sectionProviders.filter((p) => p.enabled).length > 1

    return (
      <section key={section.capability} className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              {tp(section.titleKey)}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
              {tp(section.subtitleKey)}
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => openCreate(section.capability)}>
            <IconPlus size={16} />
            {t('account:apiKeys.add')}
          </button>
        </div>

        {needsDefault && (
          <p role="alert" className="field-error mb-2">
            {t('account:apiKeys.defaultRequired', { capability: section.capability })}
          </p>
        )}

        <div className="app-card overflow-hidden">
          {sectionProviders.length === 0 ? (
            <EmptyState
              icon={<IconKey size={40} stroke={1.25} />}
              title={t('account:apiKeys.emptyTitle', { capability: section.capability })}
              description={t('account:apiKeys.emptyDesc')}
              className="py-12"
            >
              <button
                type="button"
                className="btn-secondary mt-4"
                onClick={() => openCreate(section.capability)}
              >
                {t('account:apiKeys.add')}
              </button>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="dd-table providers-table user-providers-table">
                <colgroup>
                  <col className="providers-col-name" />
                  <col className="providers-col-model" />
                  <col className="providers-col-capabilities" />
                  <col className="providers-col-key" />
                  <col className="providers-col-default" />
                  <col className="providers-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{tp('col.protocol')}</th>
                    <th>{tp('col.model')}</th>
                    <th>{tp('col.capabilities')}</th>
                    <th>{tp('col.key')}</th>
                    <th>{tp('col.default')}</th>
                    <th>{tp('col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionProviders.map((p) => {
                    const isDefault = defaultProvider?.id === p.id
                    const testKey = `${p.id}:${section.capability}`
                    const ts = testState[testKey]
                    const wireCapability = section.capability === 'TEXT' ? 'TRANSLATE' : section.capability
                    const capabilityResult = ts?.result?.capabilityResults?.find(
                      (result) => result.capability === wireCapability,
                    )
                    const testDone = ts !== undefined && ts.status !== 'testing'
                    const testOk = capabilityResult ? capabilityResult.success : ts?.status === 'success'
                    const testMessage = !testDone
                      ? null
                      : testOk
                        ? `${section.capability}: ${tp('testOk')}`
                        : capabilityResult?.errorCode
                          ? `${capabilityResult.errorCode}${capabilityResult.message ? ` — ${capabilityResult.message}` : ''}`
                          : capabilityResult?.message || ts?.message || tp('testFail')
                    return (
                      <tr
                        key={`${section.capability}-${p.id}`}
                        title={capabilityResult?.errorCode
                          ? `${capabilityResult.errorCode}: ${capabilityResult.message ?? ''}`
                          : capabilityResult?.message ?? ts?.message ?? undefined}
                        className={
                          capabilityResult?.success || ts?.status === 'success'
                            ? 'test-row-success'
                            : capabilityResult || ts?.status === 'failed'
                              ? 'test-row-failed'
                              : ts?.status === 'testing'
                                ? 'test-row-testing'
                                : undefined
                        }
                      >
                        <td>
                          <button type="button" className="btn-link font-medium" onClick={() => openEdit(p)}>
                            {protocolLabel(p.protocol)}
                          </button>
                          <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">
                            {p.baseUrl}
                          </div>
                          {!p.enabled && (
                            <div className="mt-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
                              {tp('disabled')}
                            </div>
                          )}
                          {testDone && !testOk && testMessage && (
                            <div
                              className="mt-1 line-clamp-2 break-words text-[11px] font-medium text-[var(--color-error)]"
                              title={testMessage}
                            >
                              {testMessage}
                            </div>
                          )}
                        </td>
                        <td className="text-center font-mono text-xs">
                          <span className="block truncate" title={p.defaultModel}>
                            {p.defaultModel || '—'}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap justify-center gap-1">
                            {p.capabilities.map((c) => (
                              <span key={c} className="role-pill text-[10px]">
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-center font-mono text-xs text-[var(--color-text-secondary)]">
                          {p.apiKeyHint ?? '••••'}
                          {p.keyHealth === 'DOWN' && (
                            <span
                              className="mt-1 block font-sans text-[10px] font-semibold text-[var(--color-error)]"
                              title={tp('keyRejectedHint')}
                            >
                              {tp('keyRejected')}
                            </span>
                          )}
                        </td>
                        <td className="text-center">
                          {isDefault ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)]">
                              <IconStar size={14} />
                              {tp('default')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost-sm whitespace-nowrap"
                              disabled={setDefault.isPending || !p.enabled || !p.defaultModel}
                              title={
                                !p.enabled
                                  ? tp('disabled')
                                  : !p.defaultModel
                                    ? t('account:apiKeys.defaultNeedsModel')
                                    : undefined
                              }
                              onClick={() => onSetDefault(p, section.capability)}
                            >
                              {setDefault.isPending &&
                              setDefault.variables?.providerId === p.id &&
                              setDefault.variables?.capability === section.capability ? (
                                <IconLoader2 size={14} className="animate-spin" />
                              ) : (
                                tp('setDefault')
                              )}
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center justify-center gap-1">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                title={ts?.status === 'testing' ? tp('testing') : tp('test')}
                                disabled={ts?.status === 'testing'}
                                onClick={() => onTest(p, section.capability)}
                              >
                                {ts?.status === 'testing' ? (
                                  <IconLoader2 size={14} className="animate-spin" />
                                ) : (
                                  <IconPlugConnected size={14} />
                                )}
                              </button>
                              {testDone && testMessage && (
                                <span
                                  className={`inline-flex shrink-0 ${testOk ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
                                  title={testMessage}
                                  aria-label={testMessage}
                                >
                                  {testOk ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
                                </span>
                              )}
                            </div>
                            <span className="test-actions-divider" aria-hidden="true" />
                            <div className="flex items-center gap-1">
                              {section.capability === 'TTS' && (
                                <button
                                  type="button"
                                  className="btn-ghost-sm"
                                  title={tp('voices.action')}
                                  onClick={() => openVoiceCatalog(p)}
                                >
                                  <IconMicrophone2 size={16} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-ghost-sm"
                                title={t('common:actions.edit', { defaultValue: 'Edit' })}
                                onClick={() => openEdit(p)}
                              >
                                <IconEdit size={16} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon-danger"
                                disabled={deleteProvider.isPending}
                                title={tp('delete')}
                                onClick={() => onDelete(p)}
                              >
                                <IconTrash size={16} />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="providers-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('account:apiKeys.title')}</h1>
        </div>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common:loading')}
        </div>
      )}

      {isError && !isLoading && (
        <EmptyState
          icon={<IconRobot size={40} stroke={1.25} />}
          title={t('common:error.loadFailed')}
          description={error instanceof ApiError ? error.message : undefined}
          className="py-12"
        >
          <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
            {t('common:retry')}
          </button>
        </EmptyState>
      )}

      {defaultError && (
        <p role="alert" className="field-error mt-4">
          {defaultError}
        </p>
      )}

      {!isLoading && !isError && CAPABILITY_SECTIONS.map(renderSection)}

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? t('account:apiKeys.editTitle') : t('account:apiKeys.addTitle')}
        description={tp('formHint')}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setModalOpen(false)}>
              {t('common:actions.cancel')}
            </button>
            <button type="submit" form="api-key-form" className="btn-primary" disabled={saving}>
              {saving ? t('common:actions.saving') : t('common:actions.save')}
            </button>
          </>
        }
      >
        <form id="api-key-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <label className="field-label">
            <span title={tp('field.protocolTooltip')}>{tp('field.protocol')}</span>
            <select
              className="field-input"
              value={form.protocol}
              onChange={(e) => {
                const protocol = e.target.value as ProviderProtocol
                setForm((f) => {
                  const kept = supportedSubset(protocol, f.capabilities)
                  const capabilities = kept.length ? kept : [protocolCapabilities(protocol)[0]]
                  return {
                    ...f,
                    protocol,
                    capabilities,
                    defaultModel: defaultModelFor(protocol, capabilities),
                    baseUrl: defaultBaseUrlFor(protocol),
                  }
                })
                setBaseUrlHint(null)
              }}
            >
              {SELECTABLE_PROTOCOLS.map((protocol) => (
                <option key={protocol} value={protocol}>
                  {protocolLabel(protocol)}
                </option>
              ))}
            </select>
            <FieldHelp>{tp('field.protocolHelp')}</FieldHelp>
          </label>

          <label className="field-label">
            <span title={tp('field.modelTooltip')}>{tp('field.model')}</span>
            <input
              className="field-input"
              value={form.defaultModel}
              onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
              placeholder={tp('field.modelPlaceholder')}
              required
            />
            <FieldHelp>
              {isModelUnused(form.protocol) ? t('account:apiKeys.modelUnusedHelp') : tp('field.modelHelp')}
            </FieldHelp>
          </label>

          <label className="field-label sm:col-span-2">
            <span title={tp('field.baseUrlTooltip')}>{tp('field.baseUrl')}</span>
            <input
              className="field-input font-mono text-xs"
              value={form.baseUrl}
              onChange={(e) => {
                setForm((f) => ({ ...f, baseUrl: e.target.value }))
                setBaseUrlHint(null)
              }}
              onBlur={onBaseUrlBlur}
              placeholder={tp('field.baseUrlPlaceholder')}
              required
            />
            <FieldHelp>{tp('field.baseUrlHelp')}</FieldHelp>
            {baseUrlHint && <p className="field-error mt-1">{baseUrlHint}</p>}
          </label>

          <label className="field-label sm:col-span-2">
            <span title={tp('field.apiKeyTooltip')}>
              {tp('field.apiKey')}
              {editing && (
                <span className="ml-1 font-normal text-[var(--color-text-tertiary)]">
                  ({tp('apiKeyKeep')})
                </span>
              )}
            </span>
            <input
              type="password"
              className="field-input"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={editing ? (editing.apiKeyHint ?? '••••') : 'sk-…'}
              autoComplete="off"
              required={!editing}
            />
            <FieldHelp>{tp('field.apiKeyHelp')}</FieldHelp>
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="field-label mb-1" title={tp('capabilitiesTooltip')}>
              {tp('capabilities')}
            </legend>
            <FieldHelp>{t('account:apiKeys.capabilitiesHelp')}</FieldHelp>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ALL_CAPABILITIES.map((capability) => {
                const supported = protocolSupports(form.protocol, capability)
                return (
                  <label
                    key={capability}
                    title={supported ? undefined : t('account:apiKeys.capabilityUnsupported', {
                      protocol: protocolLabel(form.protocol),
                      capability,
                    })}
                    className={`flex min-h-9 items-center gap-2 border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)]${supported ? '' : ' opacity-40'}`}
                  >
                    <input
                      type="checkbox"
                      disabled={!supported}
                      checked={supported && form.capabilities.includes(capability)}
                      onChange={() => toggleCapability(capability)}
                    />
                    {capability}
                  </label>
                )
              })}
            </div>
          </fieldset>

          {editing && (
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] sm:col-span-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              {tp('enabled')}
            </label>
          )}

          {formError && <p className="field-error sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={voiceProvider !== null}
        onClose={() => {
          if (!refreshTtsVoices.isPending) setVoiceProvider(null)
        }}
        title={tp('voices.title', {
          name: voiceProvider ? protocolLabel(voiceProvider.protocol) : '',
        })}
        description={tp('voices.description')}
        size="lg"
        className="voice-catalog-modal"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              {tp('voices.activeCount', { count: voiceQuery.data?.length ?? 0 })}
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={!voiceProvider || refreshTtsVoices.isPending}
              onClick={() => {
                if (!voiceProvider) return
                setVoiceError(null)
                void refreshTtsVoices.mutateAsync(voiceProvider.id).catch((err: unknown) => {
                  setVoiceError(err instanceof ApiError ? err.message : t('common:error.generic'))
                })
              }}
            >
              <IconRefresh size={14} />
              {refreshTtsVoices.isPending ? tp('voices.refreshing') : tp('voices.refresh')}
            </button>
          </div>

          {availableLanguages.length > 0 && (
            <label className="field-label">
              <span>{tp('voices.language')}</span>
              <select
                className="field-input"
                value={voiceLanguageFilter}
                onChange={(e) => setVoiceLanguageFilter(e.target.value)}
              >
                <option value="">{tp('voices.allLanguages')}</option>
                {availableLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {formatVoiceLanguage(language.code)}
                    {' · '}
                    {tp('voices.languageCount', { count: language.voiceCount })}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="voice-catalog-table-wrap">
            {voiceQuery.isLoading ? (
              <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">{t('common:loading')}</p>
            ) : (voiceQuery.data?.length ?? 0) === 0 ? (
              <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">{tp('voices.empty')}</p>
            ) : (filteredVoices?.length ?? 0) === 0 ? (
              <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">
                {tp('voices.noneForLanguage', { language: formatVoiceLanguage(voiceLanguageFilter) })}
              </p>
            ) : (
              <table className="dd-table voice-catalog-table">
                <thead>
                  <tr>
                    <th>{tp('voices.displayName')}</th>
                    <th>{tp('voices.language')}</th>
                    <th>{tp('voices.gender')}</th>
                    <th className="voice-catalog-preview-col">{tp('voices.preview')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVoices?.map((voice) => (
                    <tr key={voice.id}>
                      <td>
                        <div className="font-medium text-[var(--color-text-primary)]">
                          {voice.displayName || voice.voiceId}
                          {voice.status === 'PREVIEW' && (
                            <span className="role-pill ml-1.5 text-[10px]">{t('media:voice.previewTag')}</span>
                          )}
                        </div>
                        <div className="voice-catalog-id" title={voice.voiceId}>
                          {voice.voiceId}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{voice.language}</td>
                      <td className="whitespace-nowrap">{voice.gender}</td>
                      <td className="voice-catalog-preview-col">
                        <button
                          type="button"
                          className="btn-secondary btn-sm whitespace-nowrap"
                          disabled={!voiceProvider || voicePreview.isPending}
                          onClick={() => {
                            if (!voiceProvider) return
                            setVoiceError(null)
                            void voicePreview
                              .mutateAsync({
                                providerId: voiceProvider.id,
                                // PreviewTtsVoiceRequest.voiceId is the tts_voices row UUID.
                                voiceRowId: voice.id,
                                language: voice.language,
                              })
                              .catch((err: unknown) => {
                                setVoiceError(
                                  `${tp('voices.previewError')}: ${
                                    err instanceof ApiError ? err.message : t('common:error.generic')
                                  }`,
                                )
                              })
                          }}
                        >
                          {voicePreview.isPending && voicePreview.variables?.voiceRowId === voice.id ? (
                            <IconLoader2 size={14} className="animate-spin" />
                          ) : (
                            <IconPlayerPlay size={14} />
                          )}
                          {tp('voices.preview')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {voiceError && (
            <p role="alert" className="field-error">
              {voiceError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
