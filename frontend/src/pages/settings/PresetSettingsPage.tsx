import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import {
  IconChevronRight,
  IconClipboardCheck,
  IconEdit,
  IconLoader2,
  IconMicrophone2,
  IconPhotoUp,
  IconPlus,
  IconStar,
  IconTrash,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { MediaStudioNav } from '@/components/media-studio/MediaStudioNav'
import { Modal } from '@/components/shared/Modal'
import { CoverLayersEditor } from '@/components/media-studio/CoverLayersEditor'
import {
  AudioPresentationConfig,
  buildPresentationPayload,
  DEFAULT_AUDIO_PRESENTATION,
  isMaxCharactersPerCueValid,
  typographyMaskBlockClass,
  type AudioPresentationValues,
} from '@/components/media-studio/RenderPreparationPanel'
import { SubtitlePreviewFrame } from '@/pages/settings/SubtitlePreviewFrame'
import { defaultCoverLayer, hydrateCoverState } from '@/lib/media/coverLayers'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { useProviders, useTtsVoiceLanguages, useTtsVoices } from '@/hooks/useProviders'
import {
  useCreateWorkflowPreset,
  useDeleteWorkflowPreset,
  useUpdateWorkflowPreset,
  useWorkflowPresets,
} from '@/hooks/useWorkflowPresets'
import {
  formatVoiceLanguage,
  isTtsProvider,
  voiceMatchesTargetLang,
} from '@/lib/media/voiceSelection'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/types/api'
import type {
  OutputAspectRatio,
  PresentationLayer,
  SubtitleDisplayMode,
  SubtitleMode,
  SubtitlePosition,
  WorkflowMode,
  WorkflowPreset,
  WorkflowPresetConfig,
  WorkflowPresetScope,
} from '@/types/media'

const POSITIONS: SubtitlePosition[] = ['BOTTOM', 'CENTER', 'TOP']

type FormState = {
  name: string
  description: string
  scope: WorkflowPresetScope
  projectId: string
  active: boolean
  isDefault: boolean
  workflowMode: WorkflowMode
  subtitleMode: SubtitleMode
  subtitlePosition: SubtitlePosition
  verticalOffsetPercent: number
  backgroundBox: boolean
  displayMode: SubtitleDisplayMode
  wordsPerPhrase: number
  maxCharactersPerCue: number
  fontSize: number | null
  bold: boolean
  /**
   * V2 cover layers (docs/97 §19.17 §B — user decision 2026-09-06): presets
   * ALWAYS store the authoritative `layers` array; a legacy stored v1 mask is
   * converted into the equivalent single SUBTITLE layer on hydrate.
   */
  coverEnabled: boolean
  coverLayers: PresentationLayer[]
  backgroundColor: string
  backgroundAlpha: number
  // PRESET-VIZ (docs/97 §19.16) v1.2 — text color #RRGGBB (legacy path).
  textColor: string
  // OUTPUT-ASPECT (docs/97 §19.19) — output frame frozen at create.
  outputAspectRatio: OutputAspectRatio
  audio: AudioPresentationValues
  providerId: string
  voiceId: string
}

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    scope: 'WORKSPACE',
    projectId: '',
    active: true,
    isDefault: false,
    workflowMode: 'AUTO',
    subtitleMode: 'HARD_SUB',
    subtitlePosition: 'BOTTOM',
    verticalOffsetPercent: 0,
    backgroundBox: true,
    displayMode: 'SENTENCE',
    wordsPerPhrase: 3,
    maxCharactersPerCue: 40,
    fontSize: null,
    bold: false,
    coverEnabled: false,
    coverLayers: [defaultCoverLayer([])],
    // #000000 at 50% alpha — visually identical to the historical
    // BackColour=&H80000000 legacy default.
    backgroundColor: '#000000',
    backgroundAlpha: 50,
    textColor: '#FFFFFF',
    outputAspectRatio: 'ORIGINAL',
    audio: { ...DEFAULT_AUDIO_PRESENTATION },
    providerId: '',
    voiceId: '',
  }
}

const HEX8_PATTERN = /^#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})$/

function splitHex8(hex8: string | null | undefined): { color: string; alpha: number } {
  const match = HEX8_PATTERN.exec(hex8 ?? '')
  if (!match) return { color: '#000000', alpha: 50 }
  const alpha = Math.round((Number.parseInt(match[2], 16) / 255) * 100)
  return { color: `#${match[1].toUpperCase()}`, alpha }
}

function composeHex8(color: string, alpha: number): string {
  const hex = color.replace(/^#/, '').toUpperCase()
  const alphaByte = Math.round((Math.max(0, Math.min(100, alpha)) / 100) * 255)
  const alphaHex = alphaByte.toString(16).padStart(2, '0').toUpperCase()
  return `#${hex}${alphaHex}`
}

function hydrateForm(preset: WorkflowPreset): FormState {
  const config = preset.config ?? {}
  const sub = config.presentation?.subtitle
  const aud = config.presentation?.audio
  const bg = splitHex8(config.backgroundColor)
  const cover = hydrateCoverState({
    mask: sub?.mask ?? null,
    layers: sub?.layers ?? null,
  })
  return {
    ...emptyForm(),
    name: preset.name,
    description: preset.description ?? '',
    scope: preset.scope === 'SYSTEM' ? 'WORKSPACE' : preset.scope,
    projectId: preset.projectId ?? '',
    active: preset.active,
    isDefault: preset.isDefault,
    workflowMode: config.workflowMode ?? 'AUTO',
    subtitleMode: config.subtitleMode ?? 'HARD_SUB',
    subtitlePosition: config.subtitlePosition ?? 'BOTTOM',
    verticalOffsetPercent: config.verticalOffsetPercent ?? 0,
    backgroundBox: config.backgroundBox ?? true,
    displayMode: sub?.displayMode ?? 'SENTENCE',
    wordsPerPhrase: sub?.wordsPerPhrase ?? 3,
    maxCharactersPerCue: sub?.maxCharactersPerCue ?? 40,
    fontSize: sub?.typography?.fontSize ?? null,
    bold: sub?.typography?.bold ?? false,
    coverEnabled: cover.enabled,
    coverLayers: cover.layers,
    backgroundColor: bg.color,
    backgroundAlpha: bg.alpha,
    textColor: /^#[0-9A-Fa-f]{6}$/.test(config.textColor ?? '')
      ? (config.textColor as string).toUpperCase()
      : '#FFFFFF',
    outputAspectRatio: config.outputAspectRatio ?? 'ORIGINAL',
    audio: {
      originalGainDb: aud?.originalGainDb ?? DEFAULT_AUDIO_PRESENTATION.originalGainDb,
      ttsGainDb: aud?.ttsGainDb ?? DEFAULT_AUDIO_PRESENTATION.ttsGainDb,
      duckingEnabled: aud?.ducking?.enabled ?? DEFAULT_AUDIO_PRESENTATION.duckingEnabled,
      duckingGainDb: aud?.ducking?.gainDb ?? DEFAULT_AUDIO_PRESENTATION.duckingGainDb,
      ttsTempo: aud?.ttsTempo ?? DEFAULT_AUDIO_PRESENTATION.ttsTempo,
    },
    providerId: config.ttsProviderId ?? '',
    voiceId: config.ttsVoiceId ?? '',
  }
}

function buildConfig(form: FormState): WorkflowPresetConfig {
  const pair =
    form.providerId.trim() && form.voiceId.trim()
      ? { ttsProviderId: form.providerId.trim(), ttsVoiceId: form.voiceId.trim() }
      : {}
  return {
    schemaVersion: 1,
    workflowMode: form.workflowMode,
    subtitleMode: form.subtitleMode,
    subtitlePosition: form.subtitlePosition,
    verticalOffsetPercent: form.verticalOffsetPercent,
    backgroundBox: form.backgroundBox,
    // PRESET-VIZ: hex8 background is sent only while the box is enabled —
    // disabling the box must not leak a color the worker cannot apply.
    ...(form.backgroundBox
      ? { backgroundColor: composeHex8(form.backgroundColor, form.backgroundAlpha) }
      : {}),
    // PRESET-VIZ v1.2: text color (#RRGGBB) is sent whenever set — it is
    // independent of the background box and applies to the legacy path.
    textColor: form.textColor,
    // OUTPUT-ASPECT (docs/97 §19.19): absent = ORIGINAL (no reframe).
    ...(form.outputAspectRatio !== 'ORIGINAL'
      ? { outputAspectRatio: form.outputAspectRatio }
      : {}),
    ...pair,
    presentation: buildPresentationPayload({
      subtitleMode: form.subtitleMode,
      displayMode: form.displayMode,
      wordsPerPhrase: form.wordsPerPhrase,
      maxCharactersPerCue: form.maxCharactersPerCue,
      fontSize: form.fontSize,
      bold: form.bold,
      coverEnabled: form.coverEnabled,
      coverLayers: form.coverLayers,
      originalGainDb: form.audio.originalGainDb,
      ttsGainDb: form.audio.ttsGainDb,
      duckingEnabled: form.audio.duckingEnabled,
      duckingGainDb: form.audio.duckingGainDb,
      ttsTempo: form.audio.ttsTempo,
    }),
  }
}

function PresetFormModal({
  preset,
  workspaceId,
  onClose,
}: {
  preset: WorkflowPreset | null
  workspaceId: string
  onClose: () => void
}) {
  const { t } = useTranslation(['media', 'common'])
  const create = useCreateWorkflowPreset(workspaceId, preset?.projectId ?? undefined)
  const update = useUpdateWorkflowPreset(workspaceId, preset?.projectId ?? undefined)
  const [form, setForm] = useState<FormState>(() =>
    preset ? hydrateForm(preset) : emptyForm(),
  )
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending
  // OUTPUT-ASPECT calibration media (docs/97 §19.19): a local video/image the
  // user uploads ONLY to align masks/subtitle against real content. It lives
  // in memory as an object URL — never uploaded to MinIO, never persisted.
  const [calibration, setCalibration] = useState<{ url: string; kind: 'video' | 'image'; name: string } | null>(null)
  const calibrationRef = useRef<string | null>(null)
  useEffect(() => () => {
    // Revoke on unmount so the object URL never leaks past the modal.
    if (calibrationRef.current) URL.revokeObjectURL(calibrationRef.current)
  }, [])
  const setCalibrationFile = (file: File | null) => {
    if (calibrationRef.current) {
      URL.revokeObjectURL(calibrationRef.current)
      calibrationRef.current = null
    }
    if (!file) {
      setCalibration(null)
      return
    }
    const url = URL.createObjectURL(file)
    calibrationRef.current = url
    setCalibration({
      url,
      kind: file.type.startsWith('video') ? 'video' : 'image',
      name: file.name,
    })
  }

  const { data: projects = [] } = useProjects(workspaceId)
  const { data: providers = [] } = useProviders(workspaceId)
  const ttsProviders = useMemo(() => providers.filter((p) => p.enabled && isTtsProvider(p)), [providers])
  const { data: voices = [] } = useTtsVoices(
    workspaceId,
    form.providerId.trim() || undefined,
  )
  // Provider → Language → Voice for the preset voice pair. Language options
  // come from the provider's ACTIVE cached catalog — never a hardcoded set.
  const { data: voiceLanguages = [] } = useTtsVoiceLanguages(
    workspaceId,
    form.providerId.trim() || undefined,
  )
  const [voiceLanguageFilter, setVoiceLanguageFilter] = useState('')
  const selectableVoices = useMemo(
    () =>
      voiceLanguageFilter
        ? voices.filter((voice) => voiceMatchesTargetLang(voice, voiceLanguageFilter))
        : voices,
    [voices, voiceLanguageFilter],
  )

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const halfPair =
    Boolean(form.providerId.trim()) !== Boolean(form.voiceId.trim())
  const charactersInvalid =
    form.displayMode === 'CHARACTERS' && !isMaxCharactersPerCueValid(form.maxCharactersPerCue)
  const canSave =
    form.name.trim().length > 0
    && !halfPair
    && !charactersInvalid
    && (form.scope !== 'PROJECT' || form.projectId.trim().length > 0)
    && !pending

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'WORKFLOW_PRESET_DEFAULT_CONFLICT') {
      setError(t('media:workflowPresetAdmin.defaultConflict'))
      return
    }
    setError(e instanceof ApiError ? e.message : t('common:error.generic'))
  }

  const submit = async () => {
    if (!canSave) return
    setError(null)
    const body = {
      scope: form.scope,
      name: form.name.trim(),
      description: form.description.trim() || null,
      config: buildConfig(form),
      schemaVersion: 1,
      active: form.active,
      isDefault: form.isDefault,
      projectId: form.scope === 'PROJECT' ? form.projectId.trim() : null,
    }
    try {
      if (preset) {
        await update.mutateAsync({ presetId: preset.id, body })
      } else {
        await create.mutateAsync(body)
      }
      onClose()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        preset
          ? t('media:workflowPresetAdmin.editTitle')
          : t('media:workflowPresetAdmin.createTitle')
      }
      description={t('media:workflowPresetAdmin.formHint')}
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            {t('common:cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            data-testid="preset-form-save"
            disabled={!canSave}
            onClick={() => void submit()}
          >
            {pending && <IconLoader2 size={16} className="animate-spin" />}
            {preset ? t('common:save') : t('media:workflowPresetAdmin.create')}
          </button>
        </>
      }
    >
      <div
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_480px]"
        data-testid="preset-form"
      >
        <div className="min-w-0 space-y-4 lg:order-1">
          {error && (
            <div role="alert" className="field-error m-0">
              {error}
            </div>
          )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            <span>{t('media:workflowPresetAdmin.name')}</span>
            <input
              className="field-input"
              value={form.name}
              maxLength={200}
              onChange={(e) => set('name', e.target.value)}
            />
          </label>
          <label className="field-label">
            <span>{t('media:workflowPresetAdmin.scope')}</span>
            <select
              className="field-input"
              value={form.scope}
              disabled={Boolean(preset)}
              onChange={(e) => set('scope', e.target.value as WorkflowPresetScope)}
            >
              <option value="WORKSPACE">{t('media:workflowPreset.scopeWorkspace')}</option>
              <option value="PROJECT">{t('media:workflowPreset.scopeProject')}</option>
            </select>
          </label>
          {form.scope === 'PROJECT' && (
            <label className="field-label">
              <span>{t('media:workflowPresetAdmin.project')}</span>
              <select
                className="field-input"
                value={form.projectId}
                disabled={Boolean(preset)}
                onChange={(e) => set('projectId', e.target.value)}
              >
                <option value="">{t('media:workflowPresetAdmin.selectProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field-label">
            <span>{t('media:workflowPresetAdmin.description')}</span>
            <input
              className="field-input"
              value={form.description}
              maxLength={4000}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            {t('media:workflowPresetAdmin.active')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
            />
            {t('media:workflowPresetAdmin.isDefault')}
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            <span>{t('media:workflow.modeLabel')}</span>
            <select
              className="field-input"
              value={form.workflowMode}
              onChange={(e) => set('workflowMode', e.target.value as WorkflowMode)}
            >
              <option value="AUTO">{t('media:workflow.auto')}</option>
              <option value="MANUAL">{t('media:workflow.manual')}</option>
            </select>
          </label>
          <label className="field-label">
            <span>{t('media:subtitleModeLabel')}</span>
            <select
              className="field-input"
              value={form.subtitleMode}
              onChange={(e) => set('subtitleMode', e.target.value as SubtitleMode)}
            >
              <option value="HARD_SUB">{t('media:subtitleHard')}</option>
              <option value="SOFT_SUB">{t('media:subtitleSoft')}</option>
            </select>
          </label>
          <label className="field-label">
            <span>{t('media:renderPrep.position')}</span>
            <select
              className="field-input"
              value={form.subtitlePosition}
              onChange={(e) => set('subtitlePosition', e.target.value as SubtitlePosition)}
            >
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`media:renderPrep.${p.toLowerCase()}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>{t('media:renderPrep.offset', { value: form.verticalOffsetPercent })}</span>
            <input
              type="range"
              min={-30}
              max={30}
              value={form.verticalOffsetPercent}
              onChange={(e) => set('verticalOffsetPercent', Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.backgroundBox}
              onChange={(e) => set('backgroundBox', e.target.checked)}
            />
            {t('media:renderPrep.backgroundBox')}
          </label>
          {form.backgroundBox && (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
              <label className="field-label">
                <span>{t('media:workflowPresetAdmin.backgroundColor')}</span>
                <input
                  type="color"
                  className="field-input h-9 w-full p-1"
                  data-testid="preset-form-background-color"
                  value={form.backgroundColor}
                  onChange={(e) => set('backgroundColor', e.target.value)}
                />
              </label>
              <label className="field-label">
                <span>
                  {t('media:workflowPresetAdmin.backgroundAlpha', { value: form.backgroundAlpha })}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={form.backgroundAlpha}
                  data-testid="preset-form-background-alpha"
                  onChange={(e) => set('backgroundAlpha', Number(e.target.value))}
                />
              </label>
              <p className="m-0 text-[11px] text-[var(--color-text-tertiary)] sm:col-span-2">
                {t('media:workflowPresetAdmin.bgColorStyleNote')}
              </p>
            </div>
          )}
          <label className="field-label">
            <span>{t('media:renderPrep.textColor')}</span>
            <input
              type="color"
              className="field-input h-9 w-full p-1"
              data-testid="preset-form-text-color"
              value={form.textColor}
              onChange={(e) => set('textColor', e.target.value)}
            />
          </label>
          <p className="m-0 text-[11px] text-[var(--color-text-tertiary)]">
            {t('media:renderPrep.textColorNote')}
          </p>
        </div>

        <div className="media-config-group">
          <div className="text-[12.5px] font-semibold text-[var(--color-text-primary)]">
            {t('media:renderPrep.presentationSubtitle')}
          </div>
          <div className="space-y-3 pt-3">
            <label className="field-label">
              <span>{t('media:renderPrep.displayMode')}</span>
              <select
                className="field-input"
                value={form.displayMode}
                onChange={(e) => set('displayMode', e.target.value as SubtitleDisplayMode)}
              >
                <option value="SENTENCE">{t('media:renderPrep.displayModeSentence')}</option>
                <option value="PHRASE">{t('media:renderPrep.displayModePhrase')}</option>
                <option value="WORD">{t('media:renderPrep.displayModeWord')}</option>
                <option value="CHARACTERS">{t('media:renderPrep.displayModeCharacters')}</option>
              </select>
            </label>
            {form.displayMode === 'PHRASE' && (
              <label className="field-label">
                <span>{t('media:renderPrep.wordsPerPhrase')}</span>
                <input
                  type="number"
                  min={3}
                  max={10}
                  className="field-input"
                  value={form.wordsPerPhrase}
                  onChange={(e) => set('wordsPerPhrase', Number(e.target.value))}
                />
              </label>
            )}
            {form.displayMode === 'CHARACTERS' && (
              <label className="field-label">
                <span>{t('media:renderPrep.maxCharactersPerCue')}</span>
                <input
                  type="number"
                  min={10}
                  max={80}
                  className="field-input"
                  value={form.maxCharactersPerCue}
                  onChange={(e) => set('maxCharactersPerCue', Number(e.target.value))}
                />
                {charactersInvalid && (
                  <p className="field-error m-0">{t('media:renderPrep.maxCharactersInvalid')}</p>
                )}
              </label>
            )}

            <div className={`space-y-3 ${typographyMaskBlockClass(form.subtitleMode)}`}>
              <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                {t('media:renderPrep.typography')}
              </h4>
              <label className="field-label">
                <span>{t('media:renderPrep.fontSize')}</span>
                <input
                  type="number"
                  min={16}
                  max={120}
                  className="field-input"
                  value={form.fontSize ?? ''}
                  placeholder={t('media:renderPrep.typographyDefault')}
                  onChange={(e) =>
                    set('fontSize', e.target.value === '' ? null : Math.max(16, Math.min(120, Number(e.target.value))))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.bold}
                  onChange={(e) => set('bold', e.target.checked)}
                />
                {t('media:renderPrep.bold')}
              </label>

              <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                {t('media:renderPrep.maskLayerTitle')}
              </h4>
              {/* V2 cover layers (docs/97 §19.17 §B): each layer anchors
                  independently, so several burned-in regions can be covered
                  while the subtitle sits elsewhere — layers XOR the legacy v1
                  mask, and editors only ever write layers. */}
              <CoverLayersEditor
                enabled={form.coverEnabled}
                layers={form.coverLayers}
                locked={false}
                testidPrefix="preset-form-mask"
                onChange={({ enabled, layers }) => {
                  set('coverEnabled', enabled)
                  set('coverLayers', layers)
                }}
              />
            </div>
          </div>
        </div>

        <div className="media-config-group">
          <AudioPresentationConfig
            audio={form.audio}
            locked={false}
            collapsible={false}
            onChange={(audio) => set('audio', audio)}
          />
        </div>

        <div className="media-config-group">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
            <IconMicrophone2 size={15} className="text-[var(--color-media)]" />
            <span>{t('media:workflowPresetAdmin.voiceSectionTitle')}</span>
          </div>
          <p className="mt-1 mb-3 text-xs text-[var(--color-text-secondary)]">
            {t('media:workflowPresetAdmin.voiceHint')}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="field-label">
              <span>{t('media:voice.providerLabel')}</span>
              <select
                className="field-input"
                data-testid="preset-form-provider-select"
                value={form.providerId}
                onChange={(e) => {
                  // Provider changed → the bound voice (and its language filter)
                  // belonged to the old provider — never carry a cross-provider
                  // pair into the payload.
                  setVoiceLanguageFilter('')
                  set('providerId', e.target.value)
                  set('voiceId', '')
                }}
              >
                <option value="">{t('media:workflowPresetAdmin.noVoice')}</option>
                {ttsProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>{t('media:voice.languageLabel')}</span>
              <select
                className="field-input"
                data-testid="preset-form-language-select"
                value={voiceLanguageFilter}
                disabled={!form.providerId.trim()}
                onChange={(e) => {
                  const next = e.target.value
                  setVoiceLanguageFilter(next)
                  // Selected voice no longer compatible with the chosen language
                  // → clear it; halfPair guard blocks saving until re-picked.
                  if (
                    form.voiceId
                    && !voices.some(
                      (voice) =>
                        voice.id === form.voiceId && voiceMatchesTargetLang(voice, next || null),
                    )
                  ) {
                    set('voiceId', '')
                  }
                }}
              >
                <option value="">{t('media:workflowPresetAdmin.allLanguages')}</option>
                {voiceLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {formatVoiceLanguage(language.code)}
                    {' · '}
                    {language.voiceCount}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>{t('media:voice.label')}</span>
              <select
                className="field-input"
                data-testid="preset-form-voice-select"
                value={form.voiceId}
                disabled={!form.providerId.trim()}
                onChange={(e) => set('voiceId', e.target.value)}
              >
                <option value="">{t('media:voice.voicePlaceholder')}</option>
                {selectableVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.displayName || voice.voiceId}
                    {' · '}
                    {(voice.languages ?? [voice.language]).join('/')}
                    {' · '}
                    {voice.gender}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {halfPair && (
            <p className="field-error mt-2 mb-0" data-testid="preset-form-half-pair">
              {t('media:workflowPresetAdmin.halfPair')}
            </p>
          )}
        </div>
      </div>

        <div
          className="min-w-0 space-y-3 lg:order-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto"
          data-testid="preset-preview-col"
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn-media-secondary btn-sm cursor-pointer">
              <IconPhotoUp size={14} />
              {t('media:workflowPresetAdmin.uploadCalibration')}
              <input
                type="file"
                accept="video/*,image/*"
                className="hidden"
                data-testid="preset-calibration-input"
                onChange={(e) => setCalibrationFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {calibration && (
              <>
                <span className="min-w-0 max-w-[180px] truncate text-[11px] text-[var(--color-text-tertiary)]">
                  {calibration.name}
                </span>
                <button
                  type="button"
                  className="btn-media-secondary btn-sm px-1.5 text-[var(--color-danger)]"
                  aria-label={t('media:workflowPresetAdmin.removeCalibration')}
                  data-testid="preset-calibration-remove"
                  onClick={() => setCalibrationFile(null)}
                >
                  <IconX size={13} />
                </button>
              </>
            )}
          </div>
          <p className="m-0 text-[11px] text-[var(--color-text-tertiary)]">
            {t('media:workflowPresetAdmin.calibrationNote')}
          </p>
          <SubtitlePreviewFrame
            values={{
              subtitlePosition: form.subtitlePosition,
              verticalOffsetPercent: form.verticalOffsetPercent,
              backgroundBox: form.backgroundBox,
              backgroundColor: form.backgroundColor,
              backgroundAlpha: form.backgroundAlpha,
              textColor: form.textColor,
              fontSize: form.fontSize,
              bold: form.bold,
              // V2 layers are authoritative for the preview; per-layer style
              // controls live in the CoverLayersEditor above.
              layers: form.coverEnabled ? form.coverLayers : null,
            }}
            // OUTPUT-ASPECT (docs/97 §19.19): the selector WRITES the real
            // preset field — ORIGINAL keeps the source frame.
            aspect={form.outputAspectRatio}
            onAspectChange={(aspect) => set('outputAspectRatio', aspect)}
            backgroundUrl={calibration?.url ?? null}
            backgroundKind={calibration?.kind ?? 'video'}
          />
        </div>
      </div>
    </Modal>
  )
}

function PresetCard({
  preset,
  canManage,
  onEdit,
  onDelete,
  deleting,
}: {
  preset: WorkflowPreset
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const { t } = useTranslation('media')
  const config = preset.config ?? {}
  const voiceConfigured = Boolean(config.ttsProviderId && config.ttsVoiceId)
  const system = preset.scope === 'SYSTEM'
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3"
      data-testid={`preset-card-${preset.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
            <span className="truncate">{preset.name}</span>
            {preset.isDefault && (
              <IconStar size={14} className="shrink-0 text-amber-400" aria-label={t('workflowPreset.default')} />
            )}
          </p>
          <p className="mt-0.5 mb-0 text-xs text-[var(--color-text-tertiary)]">
            {t(`workflowPreset.scope${preset.scope.charAt(0) + preset.scope.slice(1).toLowerCase()}`)}
            {config.workflowMode && (
              <>
                {' · '}
                {t(`workflow.${config.workflowMode === 'MANUAL' ? 'manual' : 'auto'}`)}
              </>
            )}
          </p>
        </div>
        {!system && canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="btn-media-secondary btn-sm"
              aria-label={t('workflowPresetAdmin.edit')}
              onClick={onEdit}
            >
              <IconEdit size={14} />
            </button>
            <button
              type="button"
              className="btn-media-secondary btn-sm text-[var(--color-danger)]"
              aria-label={t('workflowPresetAdmin.delete')}
              disabled={deleting}
              onClick={onDelete}
            >
              {deleting ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
            </button>
          </div>
        )}
      </div>
      {preset.description && (
        <p className="m-0 text-xs text-[var(--color-text-secondary)]">{preset.description}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-1.5 text-[11px]">
        {config.subtitleMode && (
          <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5">
            {t(config.subtitleMode === 'HARD_SUB' ? 'subtitleHard' : 'subtitleSoft')}
          </span>
        )}
        {config.subtitlePosition && (
          <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5">
            {t(`renderPrep.${config.subtitlePosition.toLowerCase()}`)}
          </span>
        )}
        {(() => {
          // V2 layers first — a legacy v1 mask still shows its style badge so
          // old presets read the same as before.
          const layers = (config.presentation?.subtitle?.layers ?? []).filter(
            (layer) => layer.enabled !== false,
          )
          const mask = config.presentation?.subtitle?.mask
          if (layers.length > 0) {
            return (
              <span
                className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5"
                data-testid={`preset-mask-style-${preset.id}`}
              >
                {t('renderPrep.coverCount', { used: layers.length, max: 4 })}
                {' · '}
                {t(
                  `renderPrep.maskStyle${layers.some((l) => l.type === 'BLUR') ? 'Blur' : 'Solid'}`,
                )}
              </span>
            )
          }
          if (mask?.enabled) {
            return (
              <span
                className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5"
                data-testid={`preset-mask-style-${preset.id}`}
              >
                {t(`renderPrep.maskStyle${mask.style === 'BLUR' ? 'Blur' : 'Solid'}`)}
              </span>
            )
          }
          return null
        })()}
        {config.outputAspectRatio && config.outputAspectRatio !== 'ORIGINAL' && (
          <span
            className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5"
            data-testid={`preset-aspect-${preset.id}`}
          >
            {t('workflowPresetAdmin.aspectBadge', { ratio: config.outputAspectRatio })}
          </span>
        )}
        <span
          className={`rounded-md border px-1.5 py-0.5 ${
            voiceConfigured
              ? 'border-[var(--color-media)]/40 bg-[var(--color-media-soft)] text-[var(--color-media)]'
              : 'border-[var(--color-border)] text-[var(--color-text-tertiary)]'
          }`}
          data-testid={`preset-voice-status-${preset.id}`}
          title={
            voiceConfigured
              ? t('workflowPresetAdmin.voiceConfiguredTooltip')
              : t('workflowPresetAdmin.voiceDefaultTooltip')
          }
        >
          {voiceConfigured
            ? t('workflowPresetAdmin.voiceConfigured')
            : t('workflowPresetAdmin.voiceDefault')}
        </span>
        {!preset.active && (
          <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-tertiary)]">
            {t('workflowPresetAdmin.inactive')}
          </span>
        )}
        {system && (
          <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-text-tertiary)]">
            {t('workflowPresetAdmin.systemReadOnly')}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Workflow preset administration (docs/16 §7.5 — admin milestone).
 * Presets are TEMPLATE/DEFAULT configurations, never locks: jobs resolve the
 * config once at create and freeze it; editing a preset never mutates an
 * existing job. RBAC: ADMIN/PM manage WORKSPACE/PROJECT presets; SYSTEM is
 * read-only everywhere. The backend 403/422 stays the authority.
 */
export function PresetSettingsPage() {
  const { t } = useTranslation(['media', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const canManage = usePermission('project.manage')
  useDocumentTitle(t('media:workflowPresetAdmin.title'))

  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<WorkflowPreset | null>(null)
  const [deleting, setDeleting] = useState<WorkflowPreset | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const { data: projects = [] } = useProjects(workspaceId)
  const { data: presets = [], isLoading, isError, error, refetch } =
    useWorkflowPresets(workspaceId, selectedProjectId || undefined)
  const del = useDeleteWorkflowPreset(workspaceId, selectedProjectId || undefined)

  const workspacePresets = presets.filter((p) => p.scope === 'WORKSPACE')
  const projectPresets = presets.filter((p) => p.scope === 'PROJECT')
  const systemPresets = presets.filter((p) => p.scope === 'SYSTEM')

  const confirmDelete = async () => {
    if (!deleting) return
    setPageError(null)
    try {
      await del.mutateAsync(deleting.id)
      setDeleting(null)
    } catch (e) {
      setDeleting(null)
      setPageError(e instanceof ApiError ? e.message : t('common:error.generic'))
    }
  }

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  return (
    <div className="media-studio-page">
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <Link to={`/w/${workspaceId}/media`} className="hover:text-[var(--color-media)] transition-colors">
          {t('media:title')}
        </Link>
        <IconChevronRight size={10} />
        <span className="text-[var(--color-media)]">{t('media:workflowPresetAdmin.title')}</span>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <IconVideo size={26} className="text-[var(--color-media)]" />
            {t('media:title')}
          </h1>
          <div className="page-subtitle">{t('media:subtitle')}</div>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn-primary"
            data-testid="preset-create-btn"
            onClick={openCreate}
          >
            <IconPlus size={16} />
            {t('media:workflowPresetAdmin.create')}
          </button>
        )}
      </div>

      <MediaStudioNav />

      <div className="space-y-4">
        <div className="media-banner info mb-4">
          <IconClipboardCheck size={18} />
          <div className="flex-1 text-sm">{t('media:workflowPresetAdmin.subtitle')}</div>
        </div>

      {pageError && (
        <div role="alert" className="media-panel-error-toast" data-testid="preset-page-error">
          {pageError}
        </div>
      )}

      {projects.length > 0 && (
        <div className="app-card">
          <div className="app-card-body">
            <label className="field-label max-w-xs">
              <span>{t('media:workflowPresetAdmin.projectFilter')}</span>
              <select
                className="field-input"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
              >
                <option value="">{t('media:workflowPresetAdmin.projectAll')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="app-card py-10 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common:loading')}
        </div>
      )}

      {isError && !isLoading && (
        <div className="app-card">
          <div className="app-card-body">
            <p className="field-error m-0">
              {error instanceof ApiError ? error.message : t('common:error.generic')}
            </p>
            <button type="button" className="btn-secondary mt-3" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </div>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <section className="app-card">
            <div className="app-card-header">
              <div className="app-card-title">{t('media:workflowPreset.scopeWorkspace')}</div>
            </div>
            <div className="app-card-body">
              {workspacePresets.length === 0 ? (
                <p className="m-0 text-sm text-[var(--color-text-tertiary)]">
                  {t('media:workflowPreset.empty')}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {workspacePresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      canManage={canManage}
                      deleting={del.isPending && del.variables === preset.id}
                      onEdit={() => {
                        setEditing(preset)
                        setFormOpen(true)
                      }}
                      onDelete={() => setDeleting(preset)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="app-card">
            <div className="app-card-header">
              <div className="app-card-title">
                {t('media:workflowPreset.scopeProject')}
                {selectedProjectId && (
                  <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">
                    {projects.find((p) => p.id === selectedProjectId)?.name ?? ''}
                  </span>
                )}
              </div>
            </div>
            <div className="app-card-body">
              {!selectedProjectId ? (
                <p className="m-0 text-sm text-[var(--color-text-tertiary)]">
                  {t('media:workflowPresetAdmin.projectFilterHint')}
                </p>
              ) : projectPresets.length === 0 ? (
                <p className="m-0 text-sm text-[var(--color-text-tertiary)]">
                  {t('media:workflowPreset.empty')}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {projectPresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      canManage={canManage}
                      deleting={del.isPending && del.variables === preset.id}
                      onEdit={() => {
                        setEditing(preset)
                        setFormOpen(true)
                      }}
                      onDelete={() => setDeleting(preset)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="app-card">
            <div className="app-card-header">
              <div className="app-card-title">{t('media:workflowPreset.scopeSystem')}</div>
            </div>
            <div className="app-card-body">
              {systemPresets.length === 0 ? (
                <p className="m-0 text-sm text-[var(--color-text-tertiary)]">
                  {t('media:workflowPreset.empty')}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {systemPresets.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      canManage={false}
                      deleting={false}
                      onEdit={() => undefined}
                      onDelete={() => undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
      </div>

      {formOpen && (
        <PresetFormModal
          preset={editing}
          workspaceId={workspaceId}
          onClose={() => setFormOpen(false)}
        />
      )}

      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title={t('media:workflowPresetAdmin.deleteTitle')}
          description={t('media:workflowPresetAdmin.deleteDesc')}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
                {t('common:cancel')}
              </button>
              <button
                type="button"
                className="btn-danger"
                data-testid="preset-delete-confirm"
                disabled={del.isPending}
                onClick={() => void confirmDelete()}
              >
                {del.isPending && <IconLoader2 size={16} className="animate-spin" />}
                {t('common:actions.remove')}
              </button>
            </>
          }
        >
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            {t('media:workflowPresetAdmin.deleteBody', { name: deleting.name })}
          </p>
        </Modal>
      )}
    </div>
  )
}
