import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  IconExternalLink,
  IconInfoCircle,
  IconMicrophone2,
  IconPlugConnected,
  IconPlus,
  IconPlayerPlay,
  IconLoader2,
  IconRefresh,
  IconRobot,
  IconStar,
  IconTrash,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useCreateProvider,
  useDeleteProvider,
  usePresets,
  useProviders,
  useRefreshTtsVoices,
  useTtsVoiceLanguages,
  useTtsVoices,
  useUpdateProvider,
  useUpsertTtsVoice,
  useTestProvider,
  useVoicePreview,
} from '@/hooks/useProviders'
import {
  formatVoiceLanguage,
  voiceMatchesTargetLang,
} from '@/lib/media/voiceSelection'
import { validateProviderBaseUrl } from '@/lib/providerBaseUrl'
import { ApiError } from '@/types/api'
import type {
  ProviderCapability,
  ProviderConfig,
  ProviderPreset,
  ProviderProtocol,
  TestConnectionResponse,
  UpsertTtsVoiceRequest,
} from '@/types/provider'

const CAPABILITY_SECTIONS: {
  capability: ProviderCapability
  titleKey: string
  subtitleKey: string
  future?: boolean
}[] = [
  {
    capability: 'TEXT',
    titleKey: 'providers.sectionTextTitle',
    subtitleKey: 'providers.sectionTextSubtitle',
  },
  {
    capability: 'STT',
    titleKey: 'providers.sectionSttTitle',
    subtitleKey: 'providers.sectionSttSubtitle',
  },
  {
    capability: 'TTS',
    titleKey: 'providers.sectionTtsTitle',
    subtitleKey: 'providers.sectionTtsSubtitle',
  },
  {
    capability: 'IMAGE',
    titleKey: 'providers.sectionImageTitle',
    subtitleKey: 'providers.sectionImageSubtitle',
  },
  {
    capability: 'VIDEO',
    titleKey: 'providers.sectionVideoTitle',
    subtitleKey: 'providers.sectionVideoSubtitle',
    future: true,
  },
  {
    capability: 'EMBEDDING',
    titleKey: 'providers.sectionEmbeddingTitle',
    subtitleKey: 'providers.sectionEmbeddingSubtitle',
  },
]

/** System-wide fallback shown when workspace has no EMBEDDING default (matches FastAPI settings.embedding_model). */
const SYSTEM_EMBEDDING_MODEL = 'baai/bge-m3'

const ALL_PROTOCOLS: ProviderProtocol[] = [
  'openai_compatible',
  'anthropic',
  'elevenlabs_native',
  'dashscope_native',
  'azure_speech',
  'google_speech',
  'amazon_polly',
]

const ALL_CAPABILITIES: ProviderCapability[] = [
  'TEXT',
  'STT',
  'TTS',
  'EMBEDDING',
  'IMAGE',
  'VIDEO',
]

type FormMode = 'preset' | 'custom'

type FormState = {
  mode: FormMode
  selectedPresetId: string | null
  displayName: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  defaultModel: string
  capabilities: ProviderCapability[]
  enabled: boolean
  defaultForCapabilities: ProviderCapability[]
}

const EMPTY_VOICE_FORM: UpsertTtsVoiceRequest = {
  voiceId: '',
  language: '',
  gender: 'FEMALE',
  displayName: '',
}

/** ⚠️ WARNING: This duplicates data from the backend preset registry (ProviderPresetService).
 *  Any new provider must be added in BOTH Java and TypeScript.
 *  Prefer: after preset selection, use preset.baseUrl / preset.defaultModels directly. */
function defaultModelFor(
  protocol: ProviderProtocol,
  capability: ProviderCapability,
): string {
  if (capability === 'EMBEDDING') return SYSTEM_EMBEDDING_MODEL

  switch (protocol) {
    case 'anthropic':
      return 'claude-3-5-haiku-latest'
    case 'elevenlabs_native':
      return 'eleven_multilingual_v2'
    case 'dashscope_native':
      if (capability === 'TEXT') return 'qwen-plus'
      if (capability === 'IMAGE') return 'wanx-v1'
      return 'qwen-omni-turbo'
    case 'azure_speech':
      return 'en-US-JennyNeural'
    case 'google_speech':
      return 'en-US-Neural2-A'
    case 'openai_compatible':
    default:
      if (capability === 'STT') return 'whisper-1'
      if (capability === 'TTS') return 'tts-1'
      if (capability === 'IMAGE') return 'dall-e-3'
      return 'gpt-4o-mini'
  }
}

/** ⚠️ WARNING: This duplicates data from the backend preset registry (ProviderPresetService).
 *  Any new provider must be added in BOTH Java and TypeScript.
 *  Prefer: after preset selection, use preset.baseUrl directly. */
function defaultBaseUrlFor(protocol: ProviderProtocol): string {
  switch (protocol) {
    case 'anthropic':
      return 'https://api.anthropic.com'
    case 'elevenlabs_native':
      return 'https://api.elevenlabs.io/v1'
    case 'dashscope_native':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    case 'azure_speech':
      return 'https://eastus.tts.speech.microsoft.com'
    case 'google_speech':
      return 'https://texttospeech.googleapis.com'
    case 'openai_compatible':
    default:
      return 'https://api.openai.com/v1'
  }
}

const emptyForm = (seedCapability: ProviderCapability = 'TEXT'): FormState => {
  const protocol: ProviderProtocol = 'openai_compatible'
  return {
    mode: 'preset',
    selectedPresetId: null,
    displayName: '',
    protocol,
    baseUrl: defaultBaseUrlFor(protocol),
    apiKey: '',
    defaultModel: defaultModelFor(protocol, seedCapability),
    capabilities: [seedCapability],
    enabled: true,
    defaultForCapabilities: [seedCapability],
  }
}

function formFromProvider(p: ProviderConfig): FormState {
  return {
    mode: 'custom',
    selectedPresetId: null,
    displayName: p.displayName,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    apiKey: '',
    defaultModel: p.defaultModel,
    capabilities: [...p.capabilities],
    enabled: p.enabled,
    defaultForCapabilities: [...(p.defaultFor ?? [])],
  }
}

function applyPreset(
  form: FormState,
  preset: ProviderPreset,
  seedCapability?: ProviderCapability,
): FormState {
  const targetCap =
    seedCapability && preset.capabilities.includes(seedCapability)
      ? seedCapability
      : preset.capabilities[0]
  const defaultModel =
    (targetCap && preset.defaultModels?.[targetCap]) ??
    (targetCap ? defaultModelFor(preset.protocol, targetCap) : preset.defaultModel) ??
    preset.defaultModel

  return {
    ...form,
    selectedPresetId: preset.id,
    displayName: preset.displayName,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    defaultModel,
    capabilities: [...preset.capabilities],
    defaultForCapabilities: targetCap ? [targetCap] : [],
  }
}

function FieldHelp({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <p className="field-help" title={title}>
      {children}
    </p>
  )
}

function FieldExample({ children }: { children: ReactNode }) {
  return <p className="providers-field-example">{children}</p>
}

export function ProvidersPageInner() {
  const { t } = useTranslation(['settings', 'common'])
  const { workspaceId = '' } = useParams()
  useDocumentTitle(t('settings:providers.title'))

  const { data: providers = [], isLoading, isError, error, refetch } = useProviders(workspaceId)
  const { data: recommendedPresets = [] } = usePresets(workspaceId, 'recommended')
  const { data: compatiblePresets = [] } = usePresets(workspaceId, 'openai_compatible')
  const createProvider = useCreateProvider(workspaceId)
  const updateProvider = useUpdateProvider(workspaceId)
  const deleteProvider = useDeleteProvider(workspaceId)
  const testProvider = useTestProvider(workspaceId)
  const refreshTtsVoices = useRefreshTtsVoices(workspaceId)
  const upsertTtsVoice = useUpsertTtsVoice(workspaceId)

  const allPresets = useMemo(
    () => [...recommendedPresets, ...compatiblePresets],
    [recommendedPresets, compatiblePresets],
  )

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [createSeedCapability, setCreateSeedCapability] = useState<ProviderCapability>('TEXT')
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [baseUrlHint, setBaseUrlHint] = useState<string | null>(null)
  const [testState, setTestState] = useState<
    Record<string, { status: 'testing' | 'done'; result?: TestConnectionResponse; message?: string }>
  >({})
  const [voiceProvider, setVoiceProvider] = useState<ProviderConfig | null>(null)
  const [voiceForm, setVoiceForm] = useState<UpsertTtsVoiceRequest>(EMPTY_VOICE_FORM)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  // V39 follow-up — language-first voice catalog browsing. '' = All languages;
  // canonical value is the normalized code (never a display name).
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState<string>('')
  const voiceQuery = useTtsVoices(workspaceId, voiceProvider?.id)
  const voiceLanguagesQuery = useTtsVoiceLanguages(workspaceId, voiceProvider?.id)
  const voicePreview = useVoicePreview(workspaceId)

  const availableLanguages = voiceLanguagesQuery.data ?? []

  // Exactly one language in the catalog → preselect it (never a hardcoded
  // default like English when several languages exist).
  useEffect(() => {
    if (availableLanguages.length === 1 && voiceLanguageFilter === '') {
      setVoiceLanguageFilter(availableLanguages[0].code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableLanguages.length])

  const filteredVoices = useMemo(
    () =>
      voiceLanguageFilter
        ? (voiceQuery.data ?? []).filter((voice) =>
            voiceMatchesTargetLang(voice, voiceLanguageFilter),
          )
        : voiceQuery.data,
    [voiceQuery.data, voiceLanguageFilter],
  )

  /**
   * Voice discovery strategy for the open provider, resolved from the preset
   * catalog by protocol — never hardcoded per vendor. Null = unknown protocol
   * (no preset matched): keep legacy behavior (Refresh visible).
   */
  const voiceDiscoveryForOpenProvider =
    allPresets.find((preset) => preset.protocol === voiceProvider?.protocol)?.adapter
      ?.voiceDiscovery ?? null
  const showVoiceRefresh =
    voiceDiscoveryForOpenProvider == null
    || voiceDiscoveryForOpenProvider === 'AUTO'
    || voiceDiscoveryForOpenProvider === 'STATIC'
    || voiceDiscoveryForOpenProvider === 'QUERY'

  const selectedPreset = allPresets.find((p) => p.id === form.selectedPresetId) ?? null

  const openCreate = (capability: ProviderCapability = 'TEXT') => {
    setEditing(null)
    setCreateSeedCapability(capability)
    setForm(emptyForm(capability))
    setFormError(null)
    setBaseUrlHint(null)
    setModalOpen(true)
  }

  const openEdit = (p: ProviderConfig) => {
    setEditing(p)
    setCreateSeedCapability(p.capabilities[0] ?? 'TEXT')
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
    if (result.suggestion) {
      setBaseUrlHint(
        t(result.messageKey, {
          suggestion: result.suggestion,
          defaultValue: `Use the API root, e.g. ${result.suggestion}`,
        }),
      )
    } else {
      setBaseUrlHint(t(result.messageKey))
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!form.displayName.trim() || !form.defaultModel.trim()) {
      setFormError(t('settings:providers.requiredFields'))
      return
    }
    if (!editing && !form.apiKey.trim()) {
      setFormError(t('settings:providers.apiKeyRequired'))
      return
    }
    if (form.capabilities.length === 0) {
      setFormError(t('settings:providers.capabilityRequired'))
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

    const normalizedUrl = urlResult.value
    const body = {
      displayName: form.displayName.trim(),
      protocol: form.protocol,
      baseUrl: normalizedUrl,
      apiKey: form.apiKey.trim(),
      defaultModel: form.defaultModel.trim(),
      capabilities: form.capabilities,
      enabled: form.enabled,
      defaultForCapabilities: form.defaultForCapabilities.filter((c) =>
        form.capabilities.includes(c),
      ),
    }

    if (editing) {
      updateProvider.mutate(
        {
          providerId: editing.id,
          body: {
            ...body,
            // Keep existing key when blank.
            apiKey: body.apiKey || undefined,
          },
        },
        {
          onSuccess: () => setModalOpen(false),
          onError: (err) =>
            setFormError(err instanceof ApiError ? err.message : t('common:error.generic')),
        },
      )
    } else {
      createProvider.mutate(body, {
        onSuccess: () => setModalOpen(false),
        onError: (err) =>
          setFormError(err instanceof ApiError ? err.message : t('common:error.generic')),
      })
    }
  }

  const onTest = (id: string, capability: ProviderCapability) => {
    const stateKey = `${id}:${capability}`
    setTestState((s) => ({ ...s, [stateKey]: { status: 'testing' } }))
    testProvider.mutate(
      { providerId: id, capability },
      {
        onSuccess: (res) => {
          setTestState((s) => ({ ...s, [stateKey]: { status: 'done', result: res } }))
        },
        onError: (err) => {
          setTestState((s) => ({
            ...s,
            [stateKey]: {
              status: 'done',
              message: err instanceof ApiError ? err.message : t('common:error.generic'),
            },
          }))
        },
      },
    )
  }

  const onDelete = (p: ProviderConfig) => {
    const capCount = p.capabilities.length
    if (capCount > 1) {
      const defaultList = (p.defaultFor ?? []).join(', ')
      const defaultClause = defaultList
        ? t('settings:providers.confirmDeleteMultiDefault', { defaultFor: defaultList })
        : ''
      const msg = t('settings:providers.confirmDeleteMulti', {
        capCount: String(capCount),
        capabilities: p.capabilities.join(', '),
        defaultClause,
      })
      if (!window.confirm(msg)) return
    } else {
      const isDefaultAnywhere = (p.defaultFor?.length ?? 0) > 0
      const msg = isDefaultAnywhere
        ? t('settings:providers.confirmDeleteDefault')
        : t('settings:providers.confirmDelete')
      if (!window.confirm(msg)) return
    }
    deleteProvider.mutate(p.id)
  }

  const toggleCapability = (capability: ProviderCapability) => {
    setForm((current) => {
      const has = current.capabilities.includes(capability)
      const capabilities = has
        ? current.capabilities.filter((c) => c !== capability)
        : [...current.capabilities, capability]
      // Keep default-for in sync — never default a capability we no longer expose.
      const defaultForCapabilities = current.defaultForCapabilities.filter((c) =>
        capabilities.includes(c),
      )
      return { ...current, capabilities, defaultForCapabilities }
    })
  }

  const toggleDefaultForCapability = (capability: ProviderCapability) => {
    setForm((current) => {
      if (!current.capabilities.includes(capability)) return current
      const has = current.defaultForCapabilities.includes(capability)
      const defaultForCapabilities = has
        ? current.defaultForCapabilities.filter((c) => c !== capability)
        : [...current.defaultForCapabilities, capability]
      return { ...current, defaultForCapabilities }
    })
  }

  const saving = createProvider.isPending || updateProvider.isPending

  const openVoiceCatalog = (provider: ProviderConfig) => {
    setVoiceProvider(provider)
    setVoiceForm(EMPTY_VOICE_FORM)
    setVoiceError(null)
    // Provider changed → previous language filter no longer meaningful.
    setVoiceLanguageFilter('')
  }

  const onVoiceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!voiceProvider) return
    const body = {
      voiceId: voiceForm.voiceId.trim(),
      language: voiceForm.language.trim(),
      gender: voiceForm.gender,
      displayName: voiceForm.displayName.trim(),
    }
    if (!body.voiceId || !body.language || !body.displayName) {
      setVoiceError(t('settings:providers.voices.required'))
      return
    }
    setVoiceError(null)
    try {
      await upsertTtsVoice.mutateAsync({ providerId: voiceProvider.id, body })
      setVoiceForm(EMPTY_VOICE_FORM)
    } catch (error) {
      setVoiceError(error instanceof ApiError ? error.message : t('common:error.generic'))
    }
  }

  const renderSection = (section: (typeof CAPABILITY_SECTIONS)[number]) => {
    const sectionProviders = providers.filter((p) => p.capabilities.includes(section.capability))
    const defaultProvider = sectionProviders.find((p) =>
      p.defaultFor?.includes(section.capability),
    )
    const showSystemEmbeddingFallback =
      section.capability === 'EMBEDDING' && !defaultProvider

    return (
      <section key={section.capability} className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              {t(`settings:${section.titleKey}`)}
              {section.future && (
                <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  {t('settings:providers.comingSoon')}
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
              {t(`settings:${section.subtitleKey}`)}
            </p>
            {showSystemEmbeddingFallback && (
              <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)]">
                <IconInfoCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
                <span>
                  {t('settings:providers.systemEmbeddingFallback', {
                    model: SYSTEM_EMBEDDING_MODEL,
                  })}
                </span>
              </p>
            )}
          </div>
          {!section.future && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => openCreate(section.capability)}
            >
              <IconPlus size={16} />
              {t('settings:providers.add')}
            </button>
          )}
        </div>

        <div className="app-card overflow-hidden">
          {sectionProviders.length === 0 ? (
            <EmptyState
              icon={<IconRobot size={40} stroke={1.25} />}
              title={
                section.future
                  ? t('settings:providers.futureTitle')
                  : section.capability === 'EMBEDDING'
                    ? t('settings:providers.emptyEmbeddingTitle')
                    : section.capability === 'IMAGE'
                      ? t('settings:providers.emptyImageTitle')
                      : t('settings:providers.emptyTitle')
              }
              description={
                section.future
                  ? t('settings:providers.futureDesc')
                  : section.capability === 'EMBEDDING'
                    ? t('settings:providers.emptyEmbeddingDesc')
                    : section.capability === 'IMAGE'
                      ? t('settings:providers.emptyImageDesc')
                      : t('settings:providers.emptyDesc')
              }
              className="py-12"
            >
              {!section.future && (
                <button
                  type="button"
                  className="btn-secondary mt-4"
                  onClick={() => openCreate(section.capability)}
                >
                  {t('settings:providers.add')}
                </button>
              )}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="dd-table providers-table">
                <colgroup>
                  <col className="providers-col-name" />
                  <col className="providers-col-protocol" />
                  <col className="providers-col-model" />
                  <col className="providers-col-capabilities" />
                  <col className="providers-col-default" />
                  <col className="providers-col-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('settings:providers.col.displayName')}</th>
                    <th>{t('settings:providers.col.protocol')}</th>
                    <th>{t('settings:providers.col.model')}</th>
                    <th>{t('settings:providers.col.capabilities')}</th>
                    <th>{t('settings:providers.col.default')}</th>
                    <th>{t('settings:providers.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionProviders.map((p) => {
                    const testStateKey = `${p.id}:${section.capability}`
                    const ts = testState[testStateKey]
                    const capabilityResult = ts?.result?.capabilityResults?.find((result) =>
                      result.capability === (section.capability === 'TEXT' ? 'TRANSLATE' : section.capability),
                    )
                    const isDefault = p.defaultFor?.includes(section.capability) ?? false
                    return (
                      <tr key={`${section.capability}-${p.id}`}>
                        <td>
                          <button
                            type="button"
                            className="btn-link font-medium"
                            onClick={() => openEdit(p)}
                          >
                            {p.displayName}
                          </button>
                          <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">
                            {p.baseUrl}
                          </div>
                          {!p.enabled && (
                            <div className="mt-0.5 text-[10px] font-semibold uppercase text-[var(--color-text-tertiary)]">
                              {t('settings:providers.disabled')}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="role-pill">
                            {t(`settings:providers.types.${p.protocol}`, {
                              defaultValue: p.protocol,
                            })}
                          </span>
                        </td>
                        <td className="font-mono text-xs">
                          <span className="block truncate" title={p.defaultModel}>
                            {p.defaultModel}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {p.capabilities.map((c) => (
                              <span key={c} className="role-pill text-[10px]">
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {isDefault ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)]">
                              <IconStar size={14} />
                              {t('settings:providers.default')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn-ghost-sm"
                              disabled={updateProvider.isPending || !p.enabled}
                              onClick={() => updateProvider.mutate({
                                providerId: p.id,
                                body: { defaultForCapabilities: [...new Set([...(p.defaultFor ?? []), section.capability])] },
                              })}
                            >
                              {t('settings:providers.setDefault')}
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={ts?.status === 'testing'}
                              onClick={() => onTest(p.id, section.capability)}
                            >
                              <IconPlugConnected size={14} />
                              {ts?.status === 'testing'
                                ? t('settings:providers.validation.validating')
                                : t('settings:providers.validation.validateBtn')}
                            </button>
                            {ts?.status === 'done' && (
                              <span className={`max-w-[220px] truncate text-[11px] font-medium ${capabilityResult?.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                                {capabilityResult?.success
                                  ? `${section.capability}: ${t('settings:providers.testOk')}`
                                  : `${section.capability}: ${capabilityResult?.errorCode ? `${capabilityResult.errorCode}${capabilityResult.message ? ` — ${capabilityResult.message}` : ''}` : capabilityResult?.message || ts.result?.message || ts.message || t('settings:providers.testFail')}`}
                              </span>
                            )}
                            {section.capability === 'TTS' && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => openVoiceCatalog(p)}
                              >
                                <IconMicrophone2 size={14} />
                                {t('settings:providers.voices.action')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-icon-danger"
                              disabled={deleteProvider.isPending}
                              title={t('settings:providers.delete')}
                              onClick={() => onDelete(p)}
                            >
                              <IconTrash size={16} />
                            </button>
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

  const recommendedForCapability = recommendedPresets.filter((p) =>
    p.capabilities.includes(createSeedCapability),
  )
  const compatibleForCapability = compatiblePresets.filter((p) =>
    p.capabilities.includes(createSeedCapability),
  )
  const hasRecommended = recommendedForCapability.length > 0
  const hasCompatible = compatibleForCapability.length > 0

  return (
    <div className="providers-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings:providers.title')}</h1>
          <div className="page-subtitle">{t('settings:providers.subtitle')}</div>
        </div>
      </div>

      <div className="providers-onboarding app-card mb-2 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <div className="flex items-start gap-2">
          <IconInfoCircle size={18} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
          <div>
            <p className="font-medium text-[var(--color-text-primary)]">
              {t('settings:providers.onboardingTitle')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              {t('settings:providers.onboardingDesc')}
            </p>
          </div>
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

      {!isLoading && !isError && CAPABILITY_SECTIONS.map(renderSection)}

      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? t('settings:providers.editTitle') : t('settings:providers.addTitle')}
        description={t('settings:providers.formHint')}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={() => setModalOpen(false)}
            >
              {t('common:actions.cancel')}
            </button>
            <button type="submit" form="provider-form" className="btn-primary" disabled={saving}>
              {saving ? t('common:actions.saving') : t('common:actions.save')}
            </button>
          </>
        }
      >
        <form id="provider-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          {!editing && (
            <>
              <div className="sm:col-span-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={form.mode === 'preset' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setForm((f) => ({ ...f, mode: 'preset' }))}
                >
                  {t('settings:providers.modePreset')}
                </button>
                <button
                  type="button"
                  className={form.mode === 'custom' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      mode: 'custom',
                      selectedPresetId: null,
                    }))
                  }
                >
                  {t('settings:providers.modeCustom')}
                </button>
              </div>
              <p className="sm:col-span-2 text-xs text-[var(--color-text-tertiary)]">
                {form.mode === 'preset'
                  ? t('settings:providers.modePresetHint')
                  : t('settings:providers.modeCustomHint')}
              </p>

              {form.mode === 'preset' && (
                <div className="sm:col-span-2 space-y-3">
                  {hasRecommended && (
                    <fieldset>
                      <legend className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                        {t('settings:providers.presetCategoryRecommended')}
                      </legend>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {recommendedForCapability.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={
                              form.selectedPresetId === preset.id
                                ? 'btn-primary text-xs'
                                : 'btn-secondary text-xs'
                            }
                            onClick={() => setForm((f) => applyPreset(f, preset, createSeedCapability))}
                          >
                            {preset.displayName}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}

                  {hasCompatible && (
                    <fieldset>
                      <legend className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                        {t('settings:providers.presetCategoryCompatible')}
                      </legend>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {compatibleForCapability.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={
                              form.selectedPresetId === preset.id
                                ? 'btn-primary text-xs'
                                : 'btn-secondary text-xs'
                            }
                            onClick={() => setForm((f) => applyPreset(f, preset, createSeedCapability))}
                          >
                            {preset.displayName}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}

                  {!hasRecommended && !hasCompatible && (
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t('settings:providers.noPresetsForCapability')}
                    </p>
                  )}

                  {selectedPreset && (
                    <div className="providers-preset-summary">
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        <span className="font-semibold text-[var(--color-text-primary)]">
                          {selectedPreset.displayName}
                        </span>
                        {' · '}
                        {t(`settings:providers.types.${selectedPreset.protocol}`, {
                          defaultValue: selectedPreset.protocol,
                        })}
                        {selectedPreset.authType && (
                          <>
                            {' · '}
                            {t('settings:providers.authType')}: {selectedPreset.authType}
                          </>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                        {selectedPreset.baseUrl}
                      </div>
                      {selectedPreset.adapter && (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                          <span>
                            {t('settings:providers.adapterVoiceDiscovery', { defaultValue: 'Voice discovery' })}: {selectedPreset.adapter.voiceDiscovery}
                          </span>
                          <span>
                            {t('settings:providers.adapterModelDiscovery', { defaultValue: 'Model discovery' })}: {selectedPreset.adapter.modelDiscovery}
                          </span>
                          <span>
                            {t('settings:providers.adapterRequestFormat', { defaultValue: 'Request format' })}: {selectedPreset.adapter.requestFormat}
                          </span>
                        </div>
                      )}
                      {selectedPreset.docsUrl && (
                        <a
                          href={selectedPreset.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--color-accent)]"
                        >
                          {t('settings:providers.docsLink')}
                          <IconExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <label className="field-label sm:col-span-2">
            <span title={t('settings:providers.field.displayNameTooltip')}>
              {t('settings:providers.field.displayName')}
            </span>
            <input
              className="field-input"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder={t('settings:providers.field.displayNamePlaceholder')}
              required
            />
            <FieldHelp>{t('settings:providers.field.displayNameHelp')}</FieldHelp>
            <FieldExample>
              {t('settings:providers.field.example')}: {t('settings:providers.field.displayNameExample')}
            </FieldExample>
          </label>

          <label className="field-label">
            <span title={t('settings:providers.field.protocolTooltip')}>
              {t('settings:providers.field.protocol')}
            </span>
            <select
              className="field-input"
              value={form.protocol}
              disabled={!!editing}
              onChange={(e) => {
                const protocol = e.target.value as ProviderProtocol
                setForm((f) => {
                  const primaryCap = f.capabilities[0] ?? 'TEXT'
                  return {
                    ...f,
                    protocol,
                    // Only auto-fill model/baseUrl when still on previous protocol defaults
                    // (or empty) so user custom values are not clobbered silently.
                    defaultModel: defaultModelFor(protocol, primaryCap),
                    baseUrl: defaultBaseUrlFor(protocol),
                  }
                })
              }}
            >
              {ALL_PROTOCOLS.map((protocol) => (
                <option key={protocol} value={protocol}>
                  {t(`settings:providers.types.${protocol}`, { defaultValue: protocol })}
                </option>
              ))}
            </select>
            <FieldHelp>{t('settings:providers.field.protocolHelp')}</FieldHelp>
          </label>

          <label className="field-label">
            <span title={t('settings:providers.field.modelTooltip')}>
              {t('settings:providers.field.model')}
            </span>
            <input
              className="field-input"
              value={form.defaultModel}
              onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
              placeholder={t('settings:providers.field.modelPlaceholder')}
              required
            />
            <FieldHelp>{t('settings:providers.field.modelHelp')}</FieldHelp>
            <FieldExample>
              {t('settings:providers.field.example')}: {t('settings:providers.field.modelExample')}
            </FieldExample>
          </label>

          <label className="field-label sm:col-span-2">
            <span title={t('settings:providers.field.baseUrlTooltip')}>
              {t('settings:providers.field.baseUrl')}
            </span>
            <input
              className="field-input font-mono text-xs"
              value={form.baseUrl}
              onChange={(e) => {
                setForm((f) => ({ ...f, baseUrl: e.target.value }))
                setBaseUrlHint(null)
              }}
              onBlur={onBaseUrlBlur}
              placeholder={t('settings:providers.field.baseUrlPlaceholder')}
              required
            />
            <FieldHelp>{t('settings:providers.field.baseUrlHelp')}</FieldHelp>
            <FieldExample>
              {t('settings:providers.field.example')}: {t('settings:providers.field.baseUrlExample')}
            </FieldExample>
            {baseUrlHint && <p className="field-error mt-1">{baseUrlHint}</p>}
          </label>

          <label className="field-label sm:col-span-2">
            <span title={t('settings:providers.field.apiKeyTooltip')}>
              {t('settings:providers.field.apiKey')}
              {editing && (
                <span className="ml-1 font-normal text-[var(--color-text-tertiary)]">
                  ({t('settings:providers.apiKeyKeep')})
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
            <FieldHelp>{t('settings:providers.field.apiKeyHelp')}</FieldHelp>
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="field-label mb-1" title={t('settings:providers.capabilitiesTooltip')}>
              {t('settings:providers.capabilities')}
            </legend>
            <FieldHelp>{t('settings:providers.capabilitiesHelp')}</FieldHelp>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_CAPABILITIES.map((capability) => (
                <label
                  key={capability}
                  className="flex min-h-9 items-center gap-2 border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)]"
                >
                  <input
                    type="checkbox"
                    checked={form.capabilities.includes(capability)}
                    onChange={() => toggleCapability(capability)}
                  />
                  {capability}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className="field-label mb-1">
              {t('settings:providers.defaultForCapabilities')}
            </legend>
            <FieldHelp>{t('settings:providers.defaultForHelp')}</FieldHelp>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {form.capabilities.length === 0 ? (
                <p className="text-xs text-[var(--color-text-tertiary)] sm:col-span-3">
                  {t('settings:providers.selectCapabilitiesFirst')}
                </p>
              ) : (
                form.capabilities.map((capability) => (
                  <label
                    key={capability}
                    className="flex min-h-9 items-center gap-2 border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)]"
                  >
                    <input
                      type="checkbox"
                      checked={form.defaultForCapabilities.includes(capability)}
                      onChange={() => toggleDefaultForCapability(capability)}
                    />
                    {capability}
                  </label>
                ))
              )}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] sm:col-span-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            {t('settings:providers.enabled')}
          </label>

          {formError && <p className="field-error sm:col-span-2">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={voiceProvider !== null}
        onClose={() => {
          if (!refreshTtsVoices.isPending && !upsertTtsVoice.isPending) setVoiceProvider(null)
        }}
        title={t('settings:providers.voices.title', {
          name: voiceProvider?.displayName ?? '',
        })}
        description={t('settings:providers.voices.description')}
        size="lg"
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              {t('settings:providers.voices.activeCount', {
                count: voiceQuery.data?.length ?? 0,
              })}
            </p>
            {showVoiceRefresh && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={!voiceProvider || refreshTtsVoices.isPending}
                onClick={() => {
                  if (!voiceProvider) return
                  setVoiceError(null)
                  void refreshTtsVoices.mutateAsync(voiceProvider.id).catch((error: unknown) => {
                    setVoiceError(
                      error instanceof ApiError ? error.message : t('common:error.generic'),
                    )
                  })
                }}
              >
                <IconRefresh size={14} />
                {refreshTtsVoices.isPending
                  ? t('settings:providers.voices.refreshing')
                  : t('settings:providers.voices.refresh')}
              </button>
            )}
          </div>

          {/* Provider → Language → Voice: the language list comes from the
              provider's ACTIVE cached catalog (tts_voices.languages) — never a
              hardcoded language set. A stale EN-only cache honestly shows EN
              only until Refresh pulls the full multilingual catalog. */}
          {availableLanguages.length > 0 && (
            <label className="field-label">
              <span>{t('settings:providers.voices.language')}</span>
              <select
                className="field-input"
                data-testid="voice-language-select"
                value={voiceLanguageFilter}
                onChange={(e) => setVoiceLanguageFilter(e.target.value)}
              >
                <option value="">{t('settings:providers.voices.allLanguages')}</option>
                {availableLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {formatVoiceLanguage(language.code)}
                    {' · '}
                    {t('settings:providers.voices.languageCount', {
                      count: language.voiceCount,
                    })}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {voiceQuery.isLoading ? (
              <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">
                {t('common:loading')}
              </p>
            ) : (voiceQuery.data?.length ?? 0) === 0 ? (
              <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">
                {t('settings:providers.voices.empty')}
              </p>
            ) : (filteredVoices?.length ?? 0) === 0 ? (
              // Selected language has no cached voices — explicit state with
              // the Refresh path, never a silent fallback to English.
              <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]" data-testid="voices-none-for-language">
                {t('settings:providers.voices.noneForLanguage', {
                  language: formatVoiceLanguage(voiceLanguageFilter),
                })}
              </p>
            ) : (
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('settings:providers.voices.displayName')}</th>
                    <th>{t('settings:providers.voices.voiceId')}</th>
                    <th>{t('settings:providers.voices.language')}</th>
                    <th>{t('settings:providers.voices.gender')}</th>
                    <th>{t('settings:providers.voices.preview')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVoices?.map((voice) => (
                    <tr key={voice.id}>
                      <td>{voice.displayName}</td>
                      <td className="font-mono text-xs">{voice.voiceId}</td>
                      <td>{voice.language}</td>
                      <td>{voice.gender}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={!voiceProvider || voicePreview.isPending}
                          onClick={() => {
                            if (!voiceProvider) return
                            setVoiceError(null)
                            void voicePreview.mutateAsync({
                              providerId: voiceProvider.id,
                              voiceRowId: voice.id,
                              language: voice.language,
                            }).catch((error: unknown) => {
                              setVoiceError(
                                `${t('settings:providers.voices.previewError')}: ${
                                  error instanceof ApiError ? error.message : t('common:error.generic')
                                }`,
                              )
                            })
                          }}
                        >
                          {voicePreview.isPending
                            && voicePreview.variables?.voiceRowId === voice.id
                            ? <IconLoader2 size={14} className="animate-spin" />
                            : <IconPlayerPlay size={14} />}
                          {t('settings:providers.voices.preview')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {voiceError && (
            <div role="alert" className="fixed bottom-5 right-5 z-[100] max-w-md rounded-xl border border-red-300 bg-white p-4 text-sm text-red-700 shadow-xl">
              {voiceError}
            </div>
          )}

          {voiceProvider?.protocol === 'openai_compatible' && (
            <form onSubmit={onVoiceSubmit} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <h3 className="m-0 text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('settings:providers.voices.manualTitle')}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {t('settings:providers.voices.manualHint')}
                </p>
              </div>
              <label>
                <span className="field-label">{t('settings:providers.voices.voiceId')}</span>
                <input
                  className="field-input"
                  value={voiceForm.voiceId}
                  onChange={(event) =>
                    setVoiceForm((current) => ({ ...current, voiceId: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">{t('settings:providers.voices.displayName')}</span>
                <input
                  className="field-input"
                  value={voiceForm.displayName}
                  onChange={(event) =>
                    setVoiceForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">{t('settings:providers.voices.language')}</span>
                <input
                  className="field-input"
                  placeholder="en-US"
                  value={voiceForm.language}
                  onChange={(event) =>
                    setVoiceForm((current) => ({ ...current, language: event.target.value }))
                  }
                />
              </label>
              <label>
                <span className="field-label">{t('settings:providers.voices.gender')}</span>
                <select
                  className="field-input"
                  value={voiceForm.gender}
                  onChange={(event) =>
                    setVoiceForm((current) => ({
                      ...current,
                      gender: event.target.value as 'MALE' | 'FEMALE',
                    }))
                  }
                >
                  <option value="FEMALE">FEMALE</option>
                  <option value="MALE">MALE</option>
                </select>
              </label>
              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                <span />
                <button type="submit" className="btn-primary" disabled={upsertTtsVoice.isPending}>
                  {upsertTtsVoice.isPending
                    ? t('common:actions.saving')
                    : t('settings:providers.voices.save')}
                </button>
              </div>
            </form>
          )}

        </div>
      </Modal>

    </div>
  )
}

export function ProvidersPage() {
  return (
    <RoleGuard action="workspace.manage_providers">
      <ProvidersPageInner />
    </RoleGuard>
  )
}
