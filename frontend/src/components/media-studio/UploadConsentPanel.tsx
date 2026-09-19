import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  IconAdjustments,
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconEdit,
  IconEye,
  IconLanguage,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconSparkles,
  IconUpload,
  IconVideo,
} from '@tabler/icons-react'
import {
  useConsentMedia,
  useMediaTermsVersion,
  useTransformationCapabilities,
  useUploadMedia,
} from '@/hooks/useMedia'
import { usePermission } from '@/hooks/usePermission'
import { useProviders } from '@/hooks/useProviders'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import {
  formatDurationMs,
  isNarrativeFeatureDisabledError,
  parseMmSs,
  presetVoiceLangMismatchKey,
  requestedDurationForRecipe,
  secondsToMmSs,
  validateMediaFile,
} from '@/lib/media'
import { cn } from '@/lib/cn'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { ExecutionModeSelector } from '@/components/media-studio/ExecutionModeSelector'
import { RecipeSelector } from '@/components/media-studio/RecipeSelector'
import { VoiceSelector } from '@/components/media-studio/VoiceSelector'
import {
  presetById,
  WorkflowPresetPicker,
} from '@/components/media-studio/WorkflowPresetPicker'
import { useWorkflowPresets } from '@/hooks/useWorkflowPresets'
import { defaultTtsProvider, isTtsProvider, type VoiceSelection } from '@/lib/media/voiceSelection'
import {
  guardCreateWithFreshCapabilities,
  modeBlock,
  reasonI18nKey,
} from '@/lib/transformationCapabilities'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { CreateMediaJobBody, MediaRecipeId, WorkflowMode } from '@/types/media'
import type { AudioExecutionMode } from '@/types/transformation'
import { createTransformationJobApi } from '@/api/transformation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'
import { featureFlags } from '@/config/featureFlags'

type Props = {
  workspaceId: string
  projectId: string
  onCreated?: (jobId: string) => void
}

/**
 * Input of the real create-job mutation (BLOCKER M-C-01 fix): every workflow
 * field the FE may send — explicit workflowMode override and the optional
 * workflowPresetId MUST be forwarded to the HTTP body verbatim; the backend
 * owns resolution/validation/freeze (explicit request wins → preset →
 * recipe-derived default).
 *
 * C2 (docs/19 §1.8.2): subtitleMode is NO LONGER sent from the create form —
 * the backend resolves it (request absent → preset → SOFT_SUB default); in
 * MANUAL it is configured at the Finish & Render checkpoint, in AUTO the
 * preset/system default freezes at create.
 */
export type CreateJobApiInput = {
  documentId: string
  recipeId: string
  sourceLang?: string
  targetLang: string
  workflowMode?: WorkflowMode
  workflowPresetId?: string | null
  requestedDurationSeconds: number | null
  requestedMode: AudioExecutionMode | null
  ttsProviderId?: string | null
  ttsVoiceId?: string | null
  enableVlm?: boolean | null
}

/**
 * Pure mapping used by the real mutation — extracted so tests can assert the
 * exact HTTP body without mocking the dependency (the BA review flagged that
 * payload tests mocked `deps.createJob` directly and never covered the
 * mutation → API mapping).
 */
export function createJobApiBody(body: CreateJobApiInput): CreateMediaJobBody {
  return {
    documentId: body.documentId,
    recipeId: body.recipeId,
    sourceLang: body.sourceLang,
    targetLang: body.targetLang,
    workflowMode: body.workflowMode,
    workflowPresetId: body.workflowPresetId,
    requestedDurationSeconds: body.requestedDurationSeconds,
    requestedMode: body.requestedMode,
    ttsProviderId: body.ttsProviderId,
    ttsVoiceId: body.ttsVoiceId,
    enableVlm: body.enableVlm,
  }
}

const DURATION_PRESETS = [
  { labelKey: 'create.preset30s', seconds: 30 },
  { labelKey: 'create.preset1m', seconds: 60 },
  { labelKey: 'create.preset2m', seconds: 120 },
  { labelKey: 'create.preset3m', seconds: 180 },
  { labelKey: 'create.preset5m', seconds: 300 },
  { labelKey: 'create.preset10m', seconds: 600 },
] as const

export function UploadConsentPanel({ workspaceId, projectId, onCreated }: Props) {
  const { t } = useTranslation(['media', 'common'])
  const navigate = useNavigate()
  const language = useUiStore((state) => state.language)
  const canUpload = usePermission('document.upload')
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = useUploadMedia(workspaceId, projectId)
  const consent = useConsentMedia(workspaceId)
  const termsQuery = useMediaTermsVersion(workspaceId)
  const providersQuery = useProviders(workspaceId)
  const ttsProviders = (providersQuery.data ?? []).filter(isTtsProvider)
  const defaultTts = defaultTtsProvider(providersQuery.data)
  const termsVersion = termsQuery.data?.termsVersion ?? '…'
  const qc = useQueryClient()
  const capabilities = useTransformationCapabilities()
  const createJob = useMutation({
    // CT4.4 prep (docs/38): FE always sends recipeId only — no dual-send of
    // processingMode. BE soft dual still accepts legacy processingMode-only
    // clients until CT4.4 hard after the deprecation window.
    // CT10.4: requestedMode carries the user's explicit choice only; the FE
    // never computes an effectiveMode — the backend owns resolution.
    // Phase C: ttsProviderId + ttsVoiceId are sent together (both or neither)
    // so the binding is persisted atomically with job creation — no separate
    // selectVoice call after create.
    // W0/M-C (BLOCKER M-C-01 fix): workflowMode + workflowPresetId MUST reach
    // the HTTP body — the backend resolves explicit request fields first.
    mutationFn: (body: CreateJobApiInput) =>
      createTransformationJobApi(workspaceId, {
        ...createJobApiBody(body),
        projectId,
        rootAssetId: body.documentId,
      }),
    onSuccess: (job) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJobs(workspaceId, projectId) })
      void qc.setQueryData(queryKeys.mediaJob(workspaceId, job.id), job)
    },
  })

  const [uploaded, setUploaded] = useState<{
    assetId: string
    documentId: string
    fileName: string
    fileSizeBytes: number
    durationMs: number | null
  } | null>(null)
  const [consented, setConsented] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  // C2 (docs/19 §1.8.2): create offers only summary.generative + localization.full
  // (extractive legacy — no create entry). Default is generative when available.
  const [recipeId, setRecipeId] = useState<MediaRecipeId>(
    featureFlags.narrativeReviewAi ? 'summary.generative' : 'localization.full',
  )
  const [generativeAvailable, setGenerativeAvailable] = useState(
    featureFlags.narrativeReviewAi,
  )
  const [enableVlm, setEnableVlm] = useState(true)
  const [sourceLang, setSourceLang] = useState('') // empty = auto-detect
  // Default to FAST mode; selector dropdown is hidden by default.
  const [requestedMode, setRequestedMode] = useState<AudioExecutionMode | null>('FAST')
  const [showAudioMode, setShowAudioMode] = useState(false)
  const [targetLang, setTargetLang] = useState('vi')
  // W0 (docs/17 Q-M-WORKFLOW-01): workflow mode default follows the recipe
  // (summary.* → MANUAL, localization.full → AUTO); the user may override.
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('AUTO')
  useEffect(() => {
    setWorkflowMode(recipeId.startsWith('summary.') ? 'MANUAL' : 'AUTO')
  }, [recipeId])
  // M-C (docs/16 §7.5): optional workflow preset id — sent verbatim on create;
  // the backend resolves/validates/freezes (explicit fields win over the preset).
  // C2: preset applies ONLY in AUTO — switching to MANUAL clears the selection.
  const [workflowPresetId, setWorkflowPresetId] = useState<string | null>(null)
  // Phase C: provider + voice chosen at create time (all-or-nothing pair).
  // Initial provider is null — the default is applied once the provider API
  // resolves (see effect below), so an async provider load never leaves a
  // stale default in state (P1 fix).
  const [voiceSelection, setVoiceSelection] = useState<VoiceSelection>({
    providerId: null,
    voiceId: null,
  })
  const [durationMmSs, setDurationMmSs] = useState('01:00')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [uploadingName, setUploadingName] = useState<string | null>(null)

  // C2 (docs/19 §1.8.2, PRESET-ADMIN §19.13): when the selected preset carries a
  // voice pair, the FE must NOT send its own explicit pair (JOB explicit wins
  // over preset at bindTtsProviderAndVoice — an auto-selected workspace default
  // would silently override the preset pair). The voice selector is hidden and
  // the pair is omitted so the preset pair takes effect.
  const presetsQuery = useWorkflowPresets(workspaceId, projectId)
  const selectedPreset = presetById(presetsQuery.data, workflowPresetId)
  const presetProvidesVoice = Boolean(
    selectedPreset?.config?.ttsProviderId && selectedPreset?.config?.ttsVoiceId,
  )

  // Sync the workspace TTS default once providers load (and whenever the
  // default changes) — only when the user has not made a selection yet.
  const defaultTtsId = defaultTts?.id
  useEffect(() => {
    if (!defaultTtsId) return
    setVoiceSelection((current) =>
      current.providerId == null && current.voiceId == null
        ? { providerId: defaultTtsId, voiceId: null }
        : current,
    )
  }, [defaultTtsId, providersQuery.isPending])

  const resetFlow = () => {
    setUploaded(null)
    setConsented(false)
    setConsentChecked(false)
    setError(null)
    setUploadPercent(0)
    setUploadingName(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDurationChange = (raw: string) => {
    if (raw.endsWith(':') && durationMmSs.length === raw.length + 1) {
      setDurationMmSs(raw.slice(0, -1))
      return
    }
    const digits = raw.replace(/\D/g, '').slice(0, 4)
    if (digits.length === 0) {
      setDurationMmSs('')
    } else if (digits.length <= 2) {
      setDurationMmSs(digits)
    } else {
      setDurationMmSs(`${digits.slice(0, 2)}:${digits.slice(2)}`)
    }
  }

  const handleDurationBlur = () => {
    const s = parseMmSs(durationMmSs)
    if (s != null && s > 0) {
      setDurationMmSs(secondsToMmSs(s))
    } else {
      const digits = durationMmSs.replace(/\D/g, '')
      if (digits.length > 0) {
        if (digits.length <= 2) {
          const mm = parseInt(digits, 10)
          setDurationMmSs(`${String(mm).padStart(2, '0')}:00`)
        } else if (digits.length === 3) {
          const mm = parseInt(digits.slice(0, 1), 10)
          const ss = parseInt(digits.slice(1), 10)
          if (ss < 60) {
            setDurationMmSs(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`)
          } else {
            setDurationMmSs('01:00')
          }
        } else if (digits.length === 4) {
          const mm = parseInt(digits.slice(0, 2), 10)
          const ss = parseInt(digits.slice(2, 4), 10)
          if (ss < 60) {
            setDurationMmSs(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`)
          } else {
            setDurationMmSs('01:00')
          }
        }
      } else {
        setDurationMmSs('01:00')
      }
    }
  }

  const handleFile = async (selected: File | null) => {
    if (!selected) return
    setError(null)
    const code = validateMediaFile(selected)
    if (code === 'FILE_TOO_LARGE') {
      setError(t('media:upload.tooLarge', { max: '500MB' }))
      return
    }
    if (code === 'INVALID_TYPE') {
      setError(t('media:upload.invalidType'))
      return
    }
    setUploaded(null)
    setConsented(false)
    setConsentChecked(false)
    setUploadPercent(0)
    setUploadingName(selected.name)
    try {
      const res = await upload.mutateAsync({
        file: selected,
        name: selected.name,
        onProgress: (pct) => setUploadPercent(pct),
      })
      if (res.durationMs != null && res.durationMs > 30 * 60 * 1000) {
        setError(t('media:upload.tooLong', { max: '30 min' }))
        setUploadingName(null)
        return
      }
      setUploaded({
        assetId: res.assetId,
        documentId: res.documentId,
        fileName: res.fileName,
        fileSizeBytes: res.fileSizeBytes,
        durationMs: res.durationMs,
      })
      if (res.consented) {
        setConsented(true)
        setConsentChecked(true)
      }
      setUploadingName(null)
    } catch (e) {
      setUploadingName(null)
      setUploadPercent(0)
      setError(e instanceof ApiError ? e.message : t('common:error.generic'))
    }
  }

  const handleConsent = async () => {
    if (!uploaded || !consentChecked) return
    setError(null)
    try {
      await consent.mutateAsync(uploaded.assetId)
      setConsented(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common:error.generic'))
    }
  }

  const handleCreate = async () => {
    if (!uploaded || !consented) return
    setError(null)
    const needsDuration = recipeId !== 'localization.full'
    const seconds = needsDuration ? parseMmSs(durationMmSs) : null
    if (needsDuration && (seconds == null || seconds <= 0)) {
      setError(t('media:create.invalidDuration'))
      return
    }

    // Requirement 7: revalidate availability immediately before creating, so a
    // snapshot that went stale while the form was open cannot leak through.
    const guard = await guardCreateWithFreshCapabilities(
      async () => (await capabilities.refetch()).data,
      requestedMode,
    )
    if (!guard.ok) {
      // Fail closed: never fall back to another mode on the user's behalf.
      if (guard.block.kind === 'unavailable') {
        setError(
          `${t('media:executionMode.blockedUnavailable', { mode: requestedMode ?? '' })} — ${t(reasonI18nKey(guard.block.reason), { defaultValue: guard.block.reason })}`,
        )
      } else {
        setError(t('media:executionMode.loadError'))
      }
      return
    }

    try {
      const job = await createMediaJobWithSelection({
        documentId: uploaded.documentId,
        recipeId,
        sourceLang: sourceLang || undefined,
        targetLang,
        workflowMode,
        workflowPresetId: workflowPresetId ?? undefined,
        requestedDurationSeconds: requestedDurationForRecipe(recipeId, seconds),
        requestedMode: guard.requestedMode,
        voiceSelection,
        presetProvidesVoice,
        enableVlm: recipeId === 'summary.generative' ? enableVlm : undefined,
        deps: {
          createJob,
          onCreated,
          navigate,
        },
      })
      onCreated?.(job.id)
      navigate(`/w/${workspaceId}/media/jobs/${job.id}`)
    } catch (e) {
      if (recipeId === 'summary.generative' && isNarrativeFeatureDisabledError(e)) {
        // C2 (docs/19 §1.8.2): no extractive fallback anymore — hide the
        // generative card and surface a clear error; the user picks
        // localization.full instead.
        setGenerativeAvailable(false)
        setError(t('media:create.generativeUnavailable'))
        return
      }
      const presetVoiceKey = presetVoiceLangMismatchKey(e)
      if (presetVoiceKey) {
        setError(t(presetVoiceKey))
        return
      }
      setError(e instanceof ApiError ? e.message : t('common:error.generic'))
    }
  }

  const effectiveSelection = requestedMode ?? capabilities.data?.defaultExecutionMode ?? null
  const selectedModeBlock = modeBlock(capabilities.data, effectiveSelection)

  // Phase C: create is ALWAYS dubbed — the request must carry a complete
  // provider+voice pair (the backend resolves the default pair when neither
  // is sent, but the FE gate requires a full pair once the selector is shown;
  // "Original audio" is achieved by deselecting later in Job Studio).
  // A missing half (provider change in flight / no compatible voice) blocks
  // Create — a stale pair can never be submitted (P1 fix — BA re-review v2).
  // C2 (docs/19 §1.8.2): when the selected AUTO preset provides the voice
  // pair, the gate is satisfied by the preset — the FE sends no pair at all.
  const missingVoicePair =
    recipeId !== 'summary.generative'
    && !presetProvidesVoice
    && (voiceSelection.providerId == null || voiceSelection.voiceId == null)

  const providersLoading = providersQuery.isPending
  const noTtsProviders = !providersLoading && ttsProviders.length === 0

  const activePreset = (() => {
    const s = parseMmSs(durationMmSs)
    if (s == null) return null
    return DURATION_PRESETS.find((p) => p.seconds === s)?.seconds ?? null
  })()

  if (!canUpload) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">{t('media:upload.noPermission')}</p>
    )
  }

  return (
    <div className="media-studio-create-layout">
      {/* Left Column: Source Media & Legal Consent */}
      <aside className="media-create-aside">
        {/* Unified Source & Consent Card */}
        <div className="media-create-aside-card media-source-group-card">
          {/* Step 1: Upload Source Media */}
          <div className="media-aside-subcard">
            <header className="media-aside-card-header">
              <div className="flex items-center gap-2">
                <span className="media-step-badge">1</span>
                <span className="font-semibold text-sm text-[var(--color-text-primary)]">
                  {t('media:upload.stepTitle')}
                </span>
              </div>
              {uploaded && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-completed-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-status-completed)]">
                  <IconCheck size={11} stroke={3} />
                  {language === 'vi' ? 'Đã tải lên' : 'Uploaded'}
                </span>
              )}
            </header>

            <div
              className={cn(
                'media-dropzone media-dropzone-aside',
                dragOver && 'drag-over',
                uploaded && 'has-file',
                upload.isPending && 'pointer-events-none opacity-80',
              )}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                void handleFile(e.dataTransfer.files?.[0] ?? null)
              }}
              onClick={() => !upload.isPending && fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />
              {uploaded ? (
                <div className="media-uploaded-preview">
                  <div className="media-dropzone-icon">
                    <IconVideo size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs text-[var(--color-text-primary)] truncate" title={uploaded.fileName}>
                      {uploaded.fileName}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                      {(uploaded.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                      {uploaded.durationMs != null && ` · ${formatDurationMs(uploaded.durationMs)}`}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="media-dropzone-empty">
                  <div className="media-dropzone-icon">
                    <IconUpload size={22} />
                  </div>
                  <div className="font-semibold text-xs text-[var(--color-text-primary)]">
                    {upload.isPending
                      ? uploadPercent >= 99
                        ? t('media:upload.processing')
                        : t('media:upload.uploading')
                      : t('media:upload.dropTitle')}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-tertiary)] mt-1">
                    {t('media:uploadHint', { maxSize: '500MB', maxDuration: '30 min' })}
                  </div>
                </div>
              )}
            </div>

            {upload.isPending && (
              <div className="media-upload-progress mt-3" aria-live="polite">
                <div className="media-upload-progress-head">
                  <span className="media-upload-progress-label">
                    {uploadPercent >= 99
                      ? t('media:upload.processing')
                      : uploadingName
                        ? t('media:upload.uploadingFile', { name: uploadingName })
                        : t('media:upload.uploading')}
                  </span>
                  <span className="media-upload-progress-pct">
                    {uploadPercent >= 99 ? '…' : `${uploadPercent}%`}
                  </span>
                </div>
                <ProgressBar value={uploadPercent >= 99 ? 100 : uploadPercent} />
                <p className="mt-2 mb-0 text-[11px] text-[var(--color-text-tertiary)]">
                  {uploadPercent >= 99
                    ? t('media:upload.processingHint')
                    : t('media:upload.progressHint')}
                </p>
              </div>
            )}

            {uploaded && (
              <div className="media-change-file-row mt-2.5 pt-2 border-t border-[var(--color-border)] flex justify-end">
                <button
                  type="button"
                  className="btn-secondary btn-sm media-change-file-btn text-xs py-1 px-2.5 inline-flex items-center gap-1.5"
                  onClick={resetFlow}
                >
                  <IconUpload size={13} />
                  {t('media:upload.changeFile')}
                </button>
              </div>
            )}
          </div>

          {/* Group Divider */}
          <div className="my-3.5 border-t border-[var(--color-border)]" />

          {/* Step 2: Consent */}
          <div className={cn('media-aside-subcard', !uploaded && 'opacity-60')}>
            <header className="media-aside-card-header">
              <div className="flex items-center gap-2">
                <span className="media-step-badge">2</span>
                <span className="font-semibold text-sm text-[var(--color-text-primary)]">
                  {t('media:consent.title')}
                </span>
              </div>
              {consented && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-status-completed-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-status-completed)]">
                  <IconCheck size={11} stroke={3} />
                  {language === 'vi' ? 'Đã xác nhận' : 'Confirmed'}
                </span>
              )}
            </header>
            <div className="media-consent-box">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-semibold text-xs text-[var(--color-text-primary)]">
                  {t('media:consent.declaration')}
                </span>
                <span className="media-consent-version">Terms {termsVersion}</span>
              </div>
              <p className="mb-2.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {t('media:consent.body')}
              </p>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2.5 transition-colors hover:border-[var(--color-media)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consentChecked}
                  disabled={!uploaded || consented}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                <span className="text-xs leading-relaxed text-[var(--color-text-primary)]">
                  {t('media:consent.checkbox')}
                </span>
              </label>
              {!consented && (
                <button
                  type="button"
                  className="btn-secondary btn-sm w-full mt-2.5 py-1.5 font-medium"
                  disabled={!uploaded || !consentChecked || consent.isPending}
                  onClick={() => void handleConsent()}
                >
                  {consent.isPending ? t('common:loading') : t('media:consentButton')}
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Right Column: Studio Configuration Canvas */}
      <main className={cn('media-create-main', !consented && 'opacity-65')}>
        <section className="media-config-master-card">
          <header className="media-config-master-header">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="media-config-master-title">
                  {t('media:createJobTitle')}
                </span>
                {uploaded && (
                  <span className="media-source-pill">
                    <IconVideo size={13} />
                    <span className="max-w-[200px] truncate">{uploaded.fileName}</span>
                    {uploaded.durationMs != null && (
                      <span className="opacity-75">· {formatDurationMs(uploaded.durationMs)}</span>
                    )}
                  </span>
                )}
              </div>
              <p className="media-config-master-subtitle">
                {language === 'vi'
                  ? 'Thiết lập công thức xử lý, ngôn ngữ, giọng đọc AI và quy trình tự động'
                  : 'Configure transformation recipe, languages, AI voice, and automated workflow'}
              </p>
            </div>
          </header>

          <div className="space-y-4">
            {/* Section 1: Recipe & Execution Mode */}
            <div className="media-config-section">
            <div className="media-config-section-title">
              <div className="media-config-section-icon">
                <IconSparkles size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] m-0">
                  {language === 'vi' ? '1. Công thức xử lý & Hiệu năng AI' : '1. Recipe & AI Performance'}
                </h3>
                <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                  {language === 'vi'
                    ? 'Chọn mục tiêu chuyển đổi video và chế độ xử lý âm thanh'
                    : 'Choose your transformation recipe and audio processing engine'}
                </p>
              </div>
            </div>

            <div className="mt-3">
              <RecipeSelector
                value={recipeId}
                disabled={!consented}
                generativeAvailable={generativeAvailable}
                onChange={(next) => {
                  setRecipeId(next)
                }}
              />
            </div>

            {recipeId === 'summary.generative' && (
              <div
                className="mt-3 border border-[var(--color-border)] rounded-xl p-3.5 bg-[var(--color-bg-surface)] flex items-center justify-between gap-3"
                data-testid="vlm-toggle-card"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="media-config-section-icon mt-0.5">
                    <IconEye size={16} className="text-[var(--color-media)]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                        {t('media:vlm.toggleTitle')}
                      </span>
                      <span
                        className={cn(
                          'media-summary-pill text-[10px] py-0.5 px-2 border-none font-medium',
                          enableVlm
                            ? 'bg-[var(--color-media-soft)] text-[var(--color-media)]'
                            : 'bg-[var(--color-bg-surface-2)] text-[var(--color-text-tertiary)]',
                        )}
                      >
                        {enableVlm ? t('media:vlm.enabledPill') : t('media:vlm.disabledPill')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-tertiary)] m-0 mt-0.5 leading-relaxed">
                      {t('media:vlm.toggleDesc')}
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    data-testid="toggle-vlm"
                    className="sr-only peer"
                    checked={enableVlm}
                    disabled={!consented}
                    onChange={(e) => setEnableVlm(e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--color-media)]"></div>
                </label>
              </div>
            )}

            {/* Audio Execution Mode (Dropdown, Default Hidden, Default FAST) */}
            <div className="mt-3 border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-bg-surface)]">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-2)] transition-colors"
                onClick={() => setShowAudioMode(!showAudioMode)}
              >
                <div className="flex items-center gap-2">
                  <IconAdjustments size={14} className="text-[var(--color-media)]" />
                  <span>
                    {language === 'vi' ? 'Chế độ xử lý audio (Nâng cao)' : 'Audio Execution Mode (Advanced)'}
                  </span>
                  <span className="media-summary-pill text-[11px] py-0.5 px-2 bg-[var(--color-media-soft)] text-[var(--color-media)] border-none font-medium">
                    {effectiveSelection === 'STUDIO'
                      ? (language === 'vi' ? 'Cân bằng (Studio)' : 'Balanced (Studio)')
                      : (language === 'vi' ? 'Tốc độ cao (Fast)' : 'Fast')}
                  </span>
                </div>
                <IconChevronDown
                  size={15}
                  className={cn(
                    'transition-transform duration-200 text-[var(--color-text-tertiary)]',
                    showAudioMode && 'rotate-180',
                  )}
                />
              </button>
              {showAudioMode && (
                <div className="p-3 pt-0 border-t border-[var(--color-border)] mt-2">
                  <ExecutionModeSelector
                    projection={capabilities.data}
                    value={requestedMode ?? capabilities.data?.defaultExecutionMode ?? 'FAST'}
                    loading={capabilities.isPending}
                    error={capabilities.isError}
                    disabled={!consented}
                    onChange={setRequestedMode}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Languages & AI Voice */}
          <div className="media-config-section">
            <div className="media-config-section-title">
              <div className="media-config-section-icon">
                <IconLanguage size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] m-0">
                  {language === 'vi' ? '2. Ngôn ngữ & Giọng đọc AI' : '2. Languages & AI Voice'}
                </h3>
                <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                  {language === 'vi'
                    ? 'Chọn hướng dịch thuật và cấu hình giọng lồng tiếng tự nhiên'
                    : 'Configure translation direction and natural speech voice'}
                </p>
              </div>
            </div>

            {/* Language bridge: Source -> Arrow -> Target */}
            <div className="media-lang-bridge-container mt-3">
              <div className="media-lang-box">
                <label className="field-label m-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                    <IconLanguage size={14} className="text-[var(--color-media)]" />
                    {t('media:sourceLangLabel')}
                  </span>
                  <select
                    className="field-input mt-1.5"
                    value={sourceLang}
                    disabled={!consented}
                    onChange={(e) => setSourceLang(e.target.value)}
                  >
                    <option value="">{t('media:sourceLangAuto')}</option>
                    {LANG_OPTIONS.map((lang) => (
                      <option key={lang} value={lang}>
                        {formatLanguageOption(lang, language)}
                      </option>
                    ))}
                  </select>
                  <span className="field-help text-[11px] mt-1 block">
                    {t('media:sourceLangHelp')}
                  </span>
                </label>
              </div>

              <div className="media-lang-bridge-arrow" aria-hidden="true">
                <IconArrowRight size={18} />
              </div>

              <div className="media-lang-box">
                <label className="field-label m-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                    <IconLanguage size={14} className="text-[var(--color-media)]" />
                    {t('media:targetLangLabel')} <span className="text-[var(--color-accent)]">*</span>
                  </span>
                  <select
                    className="field-input mt-1.5"
                    value={targetLang}
                    disabled={!consented}
                    onChange={(e) => {
                      setTargetLang(e.target.value)
                      // The currently selected voice may no longer be compatible
                      // with the new target language — never submit a stale pair
                      // (P1 fix). VoiceSelector auto-selects a compatible voice
                      // after the voices reload; until then the create button
                      // stays disabled (missingVoicePair).
                      setVoiceSelection({ providerId: null, voiceId: null })
                    }}
                  >
                    {LANG_OPTIONS.map((lang) => (
                      <option key={lang} value={lang}>
                        {formatLanguageOption(lang, language)}
                      </option>
                    ))}
                  </select>
                  <span className="field-help text-[11px] mt-1">
                    {language === 'vi' ? 'Ngôn ngữ đích cho phụ đề và lồng tiếng' : 'Target language for subtitles & dubbing'}
                  </span>
                </label>
              </div>
            </div>

            {/* Voice configuration */}
            <div className="mt-3.5">
              <div className="media-config-block">
                {presetProvidesVoice ? (
                  <div data-testid="preset-voice-note">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                      <IconLanguage size={14} className="text-[var(--color-media)]" />
                      {t('media:voice.presetVoiceTitle')}
                    </div>
                    <p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                      {t('media:voice.presetVoiceHint')}
                    </p>
                  </div>
                ) : (
                  <VoiceSelector
                    workspaceId={workspaceId}
                    providers={ttsProviders}
                    targetLang={targetLang}
                    selectedProviderId={voiceSelection.providerId}
                    selectedVoiceId={voiceSelection.voiceId}
                    disabled={!consented}
                    autoSelect
                    showPreview
                    onChange={setVoiceSelection}
                    onPendingChange={setVoiceSelection}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Workflow Mode & Target Duration */}
          <div className="media-config-section">
            <div className="media-config-section-title">
              <div className="media-config-section-icon">
                <IconAdjustments size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] m-0">
                  {language === 'vi' ? '3. Quy trình thực thi & Thời lượng' : '3. Workflow Execution & Duration'}
                </h3>
                <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                  {language === 'vi'
                    ? 'Cấu hình mức độ tự động hóa và thời lượng mục tiêu của video'
                    : 'Configure automation mode and target video duration'}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-4 lg:grid-cols-2 items-start">
              {/* Left Column: Workflow Mode + Preset */}
              <div className="space-y-3 min-w-0">
                <div className="media-config-block">
                  <span className="field-label m-0 mb-1.5 text-xs font-semibold text-[var(--color-text-secondary)] block">
                    {t('media:workflow.modeLabel')}
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <div
                      className="media-workflow-seg shrink-0"
                      role="radiogroup"
                      aria-label={t('media:workflow.modeLabel')}
                      data-testid="workflow-mode-seg"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={workflowMode === 'MANUAL'}
                        className={cn(workflowMode === 'MANUAL' && 'active')}
                        disabled={!consented}
                        onClick={() => {
                          setWorkflowMode('MANUAL')
                          setWorkflowPresetId(null)
                        }}
                      >
                        <IconEdit size={14} className="mr-1 inline-block" />
                        {t('media:workflow.manual')}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={workflowMode === 'AUTO'}
                        className={cn(workflowMode === 'AUTO' && 'active')}
                        disabled={!consented}
                        onClick={() => setWorkflowMode('AUTO')}
                      >
                        <IconPlayerPlay size={14} className="mr-1 inline-block" />
                        {t('media:workflow.auto')}
                      </button>
                    </div>

                    <div className="text-xs text-[var(--color-text-secondary)] flex items-center gap-1.5 flex-1 min-w-[180px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-media)] shrink-0" />
                      <span className="leading-snug">
                        {workflowMode === 'MANUAL'
                          ? (language === 'vi' ? 'Dừng duyệt checkpoint trước khi xuất bản' : t('media:workflow.manualHelp'))
                          : (language === 'vi' ? 'Tự động chạy liên tục từ đầu đến cuối' : t('media:workflow.autoHelp'))}
                      </span>
                    </div>
                  </div>
                </div>

                {workflowMode === 'AUTO' && (
                  <div className="media-config-block">
                    <WorkflowPresetPicker
                      workspaceId={workspaceId}
                      projectId={projectId}
                      value={workflowPresetId}
                      onChange={setWorkflowPresetId}
                      disabled={!consented}
                      explicitMode={workflowMode}
                    />
                  </div>
                )}
              </div>

              {/* Right Column: Duration or Timeline Note */}
              <div className="space-y-3 min-w-0">
                {recipeId !== 'localization.full' ? (
                  <div className="media-config-block">
                    <div className="mb-2 flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
                        <IconClock size={15} className="text-[var(--color-media)]" />
                        {t(
                          recipeId === 'summary.generative'
                            ? 'media:create.durationLabelGenerative'
                            : 'media:create.durationLabel',
                        )}
                      </span>
                      <span className="media-duration-active-badge inline-flex items-center gap-1">
                        <IconClock size={12} stroke={2} />
                        <span>{durationMmSs}</span>
                      </span>
                    </div>
                    <div className="media-duration-presets mb-2.5">
                      {DURATION_PRESETS.map((p) => (
                        <button
                          key={p.seconds}
                          type="button"
                          className={cn('media-duration-chip', activePreset === p.seconds && 'active')}
                          disabled={!consented}
                          onClick={() => setDurationMmSs(secondsToMmSs(p.seconds))}
                        >
                          {t(`media:${p.labelKey}`)}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
                      <span className="text-xs text-[var(--color-text-tertiary)] shrink-0">
                        {language === 'vi' ? 'Hoặc nhập tuỳ chỉnh:' : 'Or custom duration:'}
                      </span>
                      <div className="relative flex items-center">
                        <IconClock
                          size={13}
                          className="absolute left-2.5 text-[var(--color-text-tertiary)] pointer-events-none"
                        />
                        <input
                          className="field-input font-mono pl-7 pr-2.5 py-1 text-xs w-[88px] text-center"
                          value={durationMmSs}
                          disabled={!consented}
                          maxLength={5}
                          onChange={(e) => handleDurationChange(e.target.value)}
                          placeholder="mm:ss"
                          onBlur={handleDurationBlur}
                          aria-label={t('media:create.durationLabel')}
                        />
                      </div>
                      <span className="text-[11px] text-[var(--color-text-tertiary)] font-medium">
                        {t('media:create.durationUnit')}
                      </span>
                    </div>
                    <span className="field-help mt-1.5 text-[11px] block">
                      {t(
                        recipeId === 'summary.generative'
                          ? 'media:create.durationHelpGenerative'
                          : 'media:create.durationHelp',
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="media-config-block">
                    <div className="flex items-center gap-2 mb-1.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
                      <IconClock size={15} className="text-[var(--color-media)]" />
                      {language === 'vi' ? 'Thời lượng video: Giữ nguyên 100%' : 'Video Duration: Original timeline'}
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed m-0">
                      {language === 'vi'
                        ? 'Chế độ Bản địa hóa toàn bộ giữ nguyên timeline và nhịp độ video gốc. Mọi câu thoại sẽ được nhận dạng, dịch và lồng tiếng đồng bộ thời gian hoàn hảo.'
                        : 'Full Localization preserves 100% of the original video timeline and pace. Every spoken sentence will be recognized, translated, and dubbed in sync.'}
                    </p>
                    {uploaded?.durationMs != null && (
                      <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-mono font-medium text-[var(--color-media)] bg-[var(--color-media-soft)] px-2.5 py-1 rounded-md">
                        <IconVideo size={13} />
                        {language === 'vi' ? 'Độ dài nguồn' : 'Source length'}: {formatDurationMs(uploaded.durationMs)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action / Launch Summary Bar */}
        <div className="media-create-action-bar mt-3.5 pt-3 border-t border-[var(--color-border)]">
          <div className="media-create-summary-strip">
            <span className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
              {language === 'vi' ? 'Tóm tắt cấu hình:' : 'Config summary:'}
            </span>
            <div className="media-summary-pills">
              <span className="media-summary-pill highlight">
                {recipeId === 'summary.generative' ? (
                  <>
                    <IconSparkles size={12} stroke={2} />
                    <span>{t('media:modeGenerative')}</span>
                  </>
                ) : (
                  <>
                    <IconLanguage size={12} stroke={2} />
                    <span>{t('media:modeTranslateOnly')}</span>
                  </>
                )}
              </span>
              <span className="media-summary-pill">
                {(sourceLang ? formatLanguageOption(sourceLang, language) : (language === 'vi' ? 'Tự nhận diện' : 'Auto-detect'))}
                {' → '}
                {formatLanguageOption(targetLang, language)}
              </span>
              <span className="media-summary-pill">
                {workflowMode === 'AUTO' ? (
                  <>
                    <IconPlayerPlay size={12} stroke={2} />
                    <span>{t('media:workflow.auto')}</span>
                  </>
                ) : (
                  <>
                    <IconEdit size={12} stroke={2} />
                    <span>{t('media:workflow.manual')}</span>
                  </>
                )}
              </span>
              {recipeId !== 'localization.full' && (
                <span className="media-summary-pill font-mono">
                  <IconClock size={12} stroke={2} />
                  <span>{durationMmSs}</span>
                </span>
              )}
              {recipeId === 'summary.generative' && (
                <span
                  className={cn(
                    'media-summary-pill',
                    enableVlm && 'text-[var(--color-media)] font-medium',
                  )}
                  data-testid="vlm-summary-pill"
                >
                  <IconEye size={12} stroke={2} />
                  <span>{enableVlm ? t('media:vlm.enabledPill') : t('media:vlm.disabledPill')}</span>
                </span>
              )}
            </div>
          </div>

          {selectedModeBlock.kind === 'unavailable' && (
            <p
              className="mt-1 mb-0 text-xs text-[var(--color-warning)] flex items-center gap-1.5"
              data-testid="execution-mode-blocked"
            >
              <IconAlertTriangle size={14} className="shrink-0" />
              <span>
                {t('media:executionMode.blockedUnavailable', { mode: effectiveSelection })}
                {' — '}
                {t(reasonI18nKey(selectedModeBlock.reason), {
                  defaultValue: selectedModeBlock.reason,
                })}
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[var(--color-text-tertiary)]">
              {missingVoicePair && !noTtsProviders && (
                <span className="text-[var(--color-warning)] flex items-center gap-1">
                  <IconAlertCircle size={14} />
                  {language === 'vi'
                    ? 'Vui lòng chọn đủ Provider và Giọng đọc trước khi tạo job.'
                    : 'Please select both Provider and Voice before creating the job.'}
                </span>
              )}
              {noTtsProviders && recipeId !== 'summary.generative' && (
                <span className="text-[var(--color-error)] flex items-center gap-1">
                  <IconAlertCircle size={14} />
                  {language === 'vi'
                    ? 'Chưa có nhà cung cấp TTS nào khả dụng trong workspace.'
                    : 'No TTS providers available in this workspace.'}
                </span>
              )}
            </div>

            <button
              type="button"
              className="btn-primary media-create-submit-btn"
              disabled={
                !consented
                || !targetLang
                || createJob.isPending
                || selectedModeBlock.kind !== 'ok'
                || missingVoicePair
                || providersLoading
                || (recipeId !== 'summary.generative' && noTtsProviders)
              }
              onClick={() => void handleCreate()}
            >
              {createJob.isPending ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconPlus size={16} />
              )}
              {createJob.isPending ? t('common:loading') : t('media:createJobSubmit')}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 p-3.5 mt-4 text-sm text-[var(--color-error)] flex items-start gap-2">
          <IconAlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      </main>
    </div>
  )
}

export type CreateJobSelection = {
  documentId: string
  recipeId: string
  sourceLang?: string
  targetLang: string
  /** W0 additive — workflow mode; absent lets the backend derive the recipe default. */
  workflowMode?: WorkflowMode
  /** M-C — optional workflow preset id; the backend resolves/validates/freezes. */
  workflowPresetId?: string
  requestedDurationSeconds: number | null
  requestedMode: AudioExecutionMode | null
  /** Phase C — provider + voice chosen at create (all-or-nothing). */
  voiceSelection: VoiceSelection
  /**
   * C2 — the selected AUTO preset carries its own voice pair. When true the
   * FE sends NO explicit pair (null/null) so the preset pair wins at
   * bindTtsProviderAndVoice (an auto-selected workspace default would
   * otherwise override it as a "JOB explicit" pair).
   */
  presetProvidesVoice?: boolean
  enableVlm?: boolean
  deps: {
    createJob: {
      mutateAsync: (body: {
        documentId: string
        recipeId: string
        sourceLang?: string
        targetLang: string
        workflowMode?: WorkflowMode
        workflowPresetId?: string | null
        requestedDurationSeconds: number | null
        requestedMode: AudioExecutionMode | null
        ttsProviderId?: string | null
        ttsVoiceId?: string | null
        enableVlm?: boolean | null
      }) => Promise<{ id: string }>
    }
    onCreated?: (jobId: string) => void
    navigate: (path: string) => void
  }
}

/**
 * Phase C — create-job submit with the provider/voice binding resolved at
 * create time. Kept as a pure exported helper (repo pattern, cf.
 * `runSubtitleStyleAssign`) so tests can assert the exact create payload
 * without driving the upload UI.
 *
 * Invariants:
 * - provider+voice must be sent together or neither — a partial pair is never
 *   submitted (the caller blocks provider-without-voice in the UI; this helper
 *   refuses it too, and the backend rejects it with 422 regardless).
 * - C2: when the selected preset provides the voice pair, the helper sends
 *   null/null so the backend applies the preset pair (JOB explicit fields
 *   would win over the preset — never auto-override a preset voice).
 * - no post-create selectVoice call: the binding is persisted atomically.
 */
/**
 * C2 (docs/97 §19.14) + bugfix live (2026-08-15): the partial-pair guard and
 * the pair payload both depend on WHO binds the voice:
 * - generative defers voice to render prep — always null/null;
 * - a preset-provided voice pair hides the VoiceSelector, so `voiceId` is
 *   never picked while the auto-default effect still fills `providerId` —
 *   the partial guard must not throw (backend binds the preset pair);
 * - otherwise (no preset, non-generative) the pair must be complete.
 * Mirrors `createVoiceGate` + the `missingVoicePair` UI gate.
 */
export async function createMediaJobWithSelection(selection: CreateJobSelection) {
  const { voiceSelection, deps } = selection
  const hasProvider = voiceSelection.providerId != null
  const hasVoice = voiceSelection.voiceId != null
  const voiceDeferred = selection.recipeId === 'summary.generative'
  const presetBindsVoice = selection.presetProvidesVoice === true
  if (!voiceDeferred && !presetBindsVoice && hasProvider !== hasVoice) {
    throw new Error('partial TTS binding: provider and voice must be sent together')
  }
  const sendPair = !presetBindsVoice && hasProvider && hasVoice
  return deps.createJob.mutateAsync({
    documentId: selection.documentId,
    recipeId: selection.recipeId,
    sourceLang: selection.sourceLang,
    targetLang: selection.targetLang,
    workflowMode: selection.workflowMode,
    workflowPresetId: selection.workflowPresetId ?? null,
    requestedDurationSeconds: selection.requestedDurationSeconds,
    requestedMode: selection.requestedMode,
    ttsProviderId: sendPair ? voiceSelection.providerId : null,
    ttsVoiceId: sendPair ? voiceSelection.voiceId : null,
    enableVlm: selection.enableVlm,
  })
}

/**
 * Phase C — create-time voice gate (BA re-review vòng 2 P1 fix). Create is
 * always dubbed: the request must carry a COMPLETE provider+voice pair. Any
 * missing half — provider change in flight (voices loading), no compatible
 * voice, provider/voice reset — blocks submission so a stale pair can never
 * be sent. C2: a preset-provided voice pair satisfies the gate (the FE sends
 * no pair and the backend binds the preset pair). Exported as a pure
 * predicate for tests.
 */
export function createVoiceGate(
  recipeId: string,
  voiceSelection: VoiceSelection,
  presetProvidesVoice = false,
): 'ok' | 'missing-voice-pair' {
  if (recipeId === 'summary.generative') return 'ok' // voice deferred to render prep
  if (presetProvidesVoice) return 'ok'
  if (voiceSelection.providerId == null || voiceSelection.voiceId == null) {
    return 'missing-voice-pair'
  }
  return 'ok'
}
