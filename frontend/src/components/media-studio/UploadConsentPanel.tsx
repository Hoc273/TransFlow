import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
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
  IconTrash,
  IconUpload,
  IconVideo,
  IconX,
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
  buildLocalizationCreateJobInput,
  createJobApiBody,
  createVoiceGate,
  BATCH_CONCURRENCY,
  mapWithConcurrency,
  type LocalizationCreateBody,
  type LocalizationJobPayloadInput,
} from '@/lib/media/batchJobPayload'
export { createJobApiBody, createVoiceGate } from '@/lib/media/batchJobPayload'
import {
  guardCreateWithFreshCapabilities,
  modeBlock,
  reasonI18nKey,
} from '@/lib/transformationCapabilities'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { MediaRecipeId, WorkflowMode } from '@/types/media'
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
 * One staged source video in the upload card. The card looks exactly like the
 * legacy single-upload UI — rows simply stack when several videos are added.
 * Uploads start immediately per file (same as the old flow); create fans out
 * over every ready row with the shared right-column config.
 */
type StagedVideo = {
  key: string
  fileName: string
  fileSizeBytes: number
  durationMs: number | null
  assetId: string | null
  documentId: string | null
  consented: boolean
  uploadStatus: 'uploading' | 'ready' | 'failed'
  progress: number
  createStatus: 'idle' | 'creating' | 'created' | 'failed'
  jobId: string | null
  error: string | null
}

let stagedKeySeq = 0
function nextStagedKey(): string {
  stagedKeySeq += 1
  return `staged-${Date.now()}-${stagedKeySeq}`
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
export type CreateJobApiInput = LocalizationCreateBody

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
      createTransformationJobApi(workspaceId, createJobApiBody(body)),
    onSuccess: (job) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJobs(workspaceId, projectId) })
      void qc.setQueryData(queryKeys.mediaJob(workspaceId, job.id), job)
    },
  })

  const [staged, setStaged] = useState<StagedVideo[]>([])
  // One confirmation covers every staged video; derived so rows added later
  // automatically reopen the consent step (same as the old reset-on-new-file).
  const consented = staged.length > 0 && staged.every((s) => s.consented)
  const [consentChecked, setConsentChecked] = useState(false)
  const [consenting, setConsenting] = useState(false)
  const [batchCreating, setBatchCreating] = useState(false)
  const [batchSummary, setBatchSummary] = useState<{ created: number; failed: number } | null>(null)
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null)
  // C2 (docs/19 §1.8.2): create offers only localization.full +
  // summary.generative (extractive legacy — no create entry). Translation is
  // the primary workflow and remains the default even when AI recap is enabled.
  const [recipeId, setRecipeId] = useState<MediaRecipeId>('localization.full')
  const [generativeAvailable, setGenerativeAvailable] = useState(
    featureFlags.narrativeReviewAi,
  )
  const [enableVlm, setEnableVlm] = useState(true)
  const [sourceLang, setSourceLang] = useState('') // empty = auto-detect
  // Default to FAST mode; selector dropdown is hidden by default.
  const [requestedMode, setRequestedMode] = useState<AudioExecutionMode | null>('FAST')
  const [showAudioMode, setShowAudioMode] = useState(false)
  // Target languages as an inline checkbox set (no separate batch view):
  // exactly one checked keeps the legacy single flow; several checked fans
  // out 1 video → N jobs. Several staged videos lock this to one language
  // (N×N cartesian is banned in v1).
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['vi'])
  // Per-target voice selections for the multi-target shape (same
  // all-or-nothing pair rule as single-create, resolved per language).
  const [targetVoices, setTargetVoices] = useState<Record<string, VoiceSelection>>({})
  const [targetJobs, setTargetJobs] = useState<Record<string, {
    status: 'idle' | 'creating' | 'created' | 'failed'
    jobId: string | null
    error: string | null
  }>>({})
  // W0 (docs/17 Q-M-WORKFLOW-01): workflow mode default follows the recipe
  // (summary.* → MANUAL, localization.full → AUTO); the user may override.
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('AUTO')
  useEffect(() => {
    setWorkflowMode(recipeId.startsWith('summary.') ? 'MANUAL' : 'AUTO')
    if (recipeId === 'summary.generative') setKeepOriginalAudio(false)
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
  // Choosing source audio is an explicit create-time decision. Keep it
  // separate from the null/null transient used while TTS options are loading.
  const [keepOriginalAudio, setKeepOriginalAudio] = useState(false)
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
    // Same default fill for untouched multi-target rows.
    setTargetVoices((prev) => {
      let changed = false
      const next = { ...prev }
      for (const lang of selectedTargets) {
        const cur = next[lang]
        if (!cur || (cur.providerId == null && cur.voiceId == null)) {
          next[lang] = { providerId: defaultTtsId, voiceId: null }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [defaultTtsId, providersQuery.isPending, selectedTargets])

  // The single-target voice pair belongs to its language — a new single
  // target invalidates it (same P1 stale-pair rule as before).
  const singleLang = selectedTargets.length === 1 ? selectedTargets[0] : null
  const prevSingleLangRef = useRef<string | null>(singleLang)
  useEffect(() => {
    if (prevSingleLangRef.current !== singleLang) {
      prevSingleLangRef.current = singleLang
      setVoiceSelection({ providerId: null, voiceId: null })
    }
  }, [singleLang])

  const patchStaged = (key: string, patch: Partial<StagedVideo>) =>
    setStaged((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const removeStaged = (key: string) => {
    if (batchCreating) return
    setBatchSummary(null)
    setStaged((prev) => prev.filter((s) => s.key !== key))
  }

  useEffect(() => {
    if (!batchSummary || batchSummary.created === 0) {
      setRedirectCountdown(null)
      return
    }

    setRedirectCountdown(3)
    const intervalId = window.setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null || prev <= 1) {
          window.clearInterval(intervalId)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    const timeoutId = window.setTimeout(() => {
      onCreated?.('')
      navigate(`/w/${workspaceId}/media?project=${projectId}#overview`)
    }, 3000)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [batchSummary, navigate, onCreated, projectId, workspaceId])

  const isMultiTarget = selectedTargets.length > 1
  // N videos × N languages is banned in v1 — with several staged videos the
  // target set stays locked to one language.
  const isNxN = staged.length > 1 && isMultiTarget

  const toggleTarget = (lang: string) => {
    if (batchCreating) return
    setBatchSummary(null)
    setSelectedTargets((prev) => {
      if (prev.includes(lang)) {
        if (prev.length === 1) return prev // keep at least one target
        return prev.filter((l) => l !== lang)
      }
      if (staged.length > 1) return prev // multi-video locks to one target
      return [...prev, lang]
    })
  }

  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false)
  const targetDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!targetDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target as Node)) {
        setTargetDropdownOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTargetDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [targetDropdownOpen])

  const setTargetJob = (
    lang: string,
    patch: Partial<{ status: 'idle' | 'creating' | 'created' | 'failed'; jobId: string | null; error: string | null }>,
  ) =>
    setTargetJobs((prev) => {
      const current = prev[lang] ?? { status: 'idle' as const, jobId: null as string | null, error: null as string | null }
      return { ...prev, [lang]: { ...current, ...patch } }
    })

  // Per-target voice gate for the multi-target shape (mirrors the single
  // missingVoicePair rule, resolved per language).
  const targetBlocked = (lang: string): boolean => {
    if (keepOriginalAudio) return false
    const sel = targetVoices[lang] ?? { providerId: null, voiceId: null }
    const rowPresetVoice = presetProvidesVoice
      && sel.providerId == null
      && sel.voiceId == null
    return createVoiceGate(recipeId, sel, rowPresetVoice) !== 'ok'
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

  // Staged intake: every added file uploads immediately (same as the old
  // single flow) and stacks as its own row in the unchanged upload card.
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    setBatchSummary(null)
    // A new file reopens the consent confirmation (same as the old reset).
    setConsentChecked(false)
    const fresh: StagedVideo[] = files.map((file) => ({
      key: nextStagedKey(),
      fileName: file.name,
      fileSizeBytes: file.size,
      durationMs: null,
      assetId: null,
      documentId: null,
      consented: false,
      uploadStatus: 'uploading',
      progress: 0,
      createStatus: 'idle',
      jobId: null,
      error: null,
    }))
    setStaged((prev) => [...prev, ...fresh])
    setUploadingName(files[0].name)
    setUploadPercent(0)
    await mapWithConcurrency(
      files.map((file, index) => ({ file, row: fresh[index] })),
      BATCH_CONCURRENCY,
      async ({ file, row }) => {
        const code = validateMediaFile(file)
        if (code === 'FILE_TOO_LARGE' || code === 'INVALID_TYPE') {
          patchStaged(row.key, {
            uploadStatus: 'failed',
            error: code === 'FILE_TOO_LARGE'
              ? t('media:upload.tooLarge', { max: '500MB' })
              : t('media:upload.invalidType'),
          })
          return
        }
        try {
          const res = await upload.mutateAsync({
            file,
            name: file.name,
            onProgress: (pct) => {
              patchStaged(row.key, { progress: pct })
              setUploadingName(file.name)
              setUploadPercent(pct)
            },
          })
          if (res.durationMs != null && res.durationMs > 30 * 60 * 1000) {
            patchStaged(row.key, {
              uploadStatus: 'failed',
              error: t('media:upload.tooLong', { max: '30 min' }),
            })
            return
          }
          patchStaged(row.key, {
            uploadStatus: 'ready',
            progress: 100,
            assetId: res.assetId,
            documentId: res.documentId,
            durationMs: res.durationMs,
            consented: res.consented,
          })
        } catch (e) {
          patchStaged(row.key, {
            uploadStatus: 'failed',
            error: e instanceof ApiError ? e.message : t('common:error.generic'),
          })
        }
      },
    )
    setUploadingName(null)
  }

  // One confirmation covers every staged video; rows that failed to upload
  // stay out of consent and create until removed.
  const handleConsent = async () => {
    const pending = staged.filter((s) => s.uploadStatus === 'ready' && !s.consented)
    if (pending.length === 0 || !consentChecked) return
    setError(null)
    setConsenting(true)
    const activeTermsVersion =
      termsQuery.data?.termsVersion || (termsVersion !== '…' ? termsVersion : undefined)
    try {
      await mapWithConcurrency(pending, BATCH_CONCURRENCY, async (s) => {
        try {
          await consent.mutateAsync({
            assetId: s.assetId as string,
            termsVersion: activeTermsVersion,
          })
          patchStaged(s.key, { consented: true, error: null })
        } catch (e) {
          patchStaged(s.key, {
            error: e instanceof ApiError ? e.message : t('common:error.generic'),
          })
        }
      })
    } finally {
      setConsenting(false)
    }
  }

  const handleCreate = async () => {
    const readyRows = staged.filter((s) => s.uploadStatus === 'ready')
    if (readyRows.length === 0 || !consented || batchCreating) return
    setError(null)
    setBatchSummary(null)
    const needsDuration = recipeId !== 'localization.full'
    const seconds = needsDuration ? parseMmSs(durationMmSs) : null
    if (needsDuration && (seconds == null || seconds <= 0)) {
      setError(t('media:create.invalidDuration'))
      return
    }

    // Requirement 7: revalidate availability immediately before creating, so a
    // snapshot that went stale while the form was open cannot leak through.
    // One guard per fan-out — every job shares the same requestedMode snapshot.
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

    const multiVideo = readyRows.length > 1
    if (!multiVideo && !isMultiTarget) {
      await createSingleJob(readyRows[0], selectedTargets[0], guard.requestedMode, seconds)
      return
    }
    if (multiVideo && !isMultiTarget) {
      await createBatchJobs(readyRows, selectedTargets[0], guard.requestedMode, seconds)
      return
    }
    if (!multiVideo && isMultiTarget) {
      await createMultiTargetJobs(readyRows[0], guard.requestedMode, seconds)
      return
    }
    // N×N is banned in v1 (the submit button stays disabled with a hint).
    setError(t('media:batch.noNxN'))
  }

  const selectionForRow = (
    row: StagedVideo,
    lang: string,
    snapshotMode: AudioExecutionMode,
    seconds: number | null,
    voice: VoiceSelection,
    rowPresetVoice: boolean,
  ) => ({
    documentId: row.documentId as string,
    projectId,
    recipeId,
    sourceLang: sourceLang || undefined,
    targetLang: lang,
    workflowMode,
    workflowPresetId: workflowPresetId ?? undefined,
    requestedDurationSeconds: requestedDurationForRecipe(recipeId, seconds),
    requestedMode: snapshotMode,
    voiceSelection: voice,
    keepOriginalAudio: recipeId !== 'summary.generative' && keepOriginalAudio,
    presetProvidesVoice: rowPresetVoice,
    enableVlm: recipeId === 'summary.generative' ? enableVlm : undefined,
  })

  const createSingleJob = async (
    row: StagedVideo,
    lang: string,
    snapshotMode: AudioExecutionMode,
    seconds: number | null,
  ) => {
    try {
      const job = await createMediaJobWithSelection({
        ...selectionForRow(row, lang, snapshotMode, seconds, voiceSelection, presetProvidesVoice),
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

  // N videos → 1 language with the shared right-column config. Partial
  // failure never rolls back siblings; retry reuses uploaded documents and
  // only re-runs rows that did not create.
  const createBatchJobs = async (
    rows: StagedVideo[],
    lang: string,
    snapshotMode: AudioExecutionMode,
    seconds: number | null,
  ) => {
    setBatchCreating(true)
    try {
      const alreadyCreated = rows.filter((s) => s.createStatus === 'created').length
      let newlyCreated = 0
      const attempted = rows.filter((s) => s.createStatus !== 'created').length
      await mapWithConcurrency(
        rows.filter((s) => s.createStatus !== 'created'),
        BATCH_CONCURRENCY,
        async (s) => {
          patchStaged(s.key, { createStatus: 'creating', error: null })
          try {
            const job = await createTransformationJobApi(
              workspaceId,
              createJobApiBody(buildLocalizationCreateJobInput(selectionForRow(s, lang, snapshotMode, seconds, voiceSelection, presetProvidesVoice))),
            )
            void qc.setQueryData(queryKeys.mediaJob(workspaceId, job.id), job)
            patchStaged(s.key, { createStatus: 'created', jobId: job.id })
            newlyCreated += 1
          } catch (e) {
            const presetVoiceKey = presetVoiceLangMismatchKey(e)
            patchStaged(s.key, {
              createStatus: 'failed',
              error: presetVoiceKey ? t(presetVoiceKey) : e instanceof ApiError ? e.message : t('common:error.generic'),
            })
          }
        },
      )
      setBatchSummary({ created: alreadyCreated + newlyCreated, failed: attempted - newlyCreated })
    } finally {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJobs(workspaceId, projectId) })
      setBatchCreating(false)
    }
  }

  // 1 video → N languages on the SAME document. Each target carries its own
  // explicit voice pair (a preset pair can never fit every language, and JOB
  // explicit fields win over the preset). Partial failure never rolls back
  // siblings; retry reuses the uploaded document and only re-runs targets
  // that did not create.
  const createMultiTargetJobs = async (
    row: StagedVideo,
    snapshotMode: AudioExecutionMode,
    seconds: number | null,
  ) => {
    setBatchCreating(true)
    try {
      const langs = selectedTargets
      const alreadyCreated = langs.filter((lang) => targetJobs[lang]?.status === 'created').length
      const pending = langs.filter((lang) => targetJobs[lang]?.status !== 'created')
      let newlyCreated = 0
      await mapWithConcurrency(pending, BATCH_CONCURRENCY, async (lang) => {
        setTargetJob(lang, { status: 'creating', error: null })
        try {
          const sel = targetVoices[lang] ?? { providerId: null, voiceId: null }
          // Multi-target dubbed rows send their own explicit pair, so the
          // preset flag must be off for them (else the payload would send
          // null/null and the backend would apply a wrong-language preset
          // voice). Untouched rows still fall back to the preset pair.
          const rowPresetVoice = presetProvidesVoice
            && sel.providerId == null
            && sel.voiceId == null
          const job = await createTransformationJobApi(
            workspaceId,
            createJobApiBody(buildLocalizationCreateJobInput(
              selectionForRow(row, lang, snapshotMode, seconds, sel, rowPresetVoice),
            )),
          )
          void qc.setQueryData(queryKeys.mediaJob(workspaceId, job.id), job)
          setTargetJob(lang, { status: 'created', jobId: job.id })
          newlyCreated += 1
        } catch (e) {
          const presetVoiceKey = presetVoiceLangMismatchKey(e)
          setTargetJob(lang, {
            status: 'failed',
            error: presetVoiceKey ? t(presetVoiceKey) : e instanceof ApiError ? e.message : t('common:error.generic'),
          })
        }
      })
      setBatchSummary({ created: alreadyCreated + newlyCreated, failed: pending.length - newlyCreated })
    } finally {
      void qc.invalidateQueries({ queryKey: queryKeys.mediaJobs(workspaceId, projectId) })
      setBatchCreating(false)
    }
  }

  const effectiveSelection = requestedMode ?? capabilities.data?.defaultExecutionMode ?? null
  const selectedModeBlock = modeBlock(capabilities.data, effectiveSelection)

  // A localization job is dubbed unless the user explicitly keeps source
  // audio at create time. Null/null while TTS is loading is not enough to
  // express that intent, hence the separate keepOriginalAudio flag.
  // A missing half (provider change in flight / no compatible voice) blocks
  // Create — a stale pair can never be submitted (P1 fix — BA re-review v2).
  // C2 (docs/19 §1.8.2): when the selected AUTO preset provides the voice
  // pair, the gate is satisfied by the preset — the FE sends no pair at all.
  const missingVoicePair =
    recipeId !== 'summary.generative'
    && !keepOriginalAudio
    && !presetProvidesVoice
    && (voiceSelection.providerId == null || voiceSelection.voiceId == null)

  const providersLoading = providersQuery.isPending
  const noTtsProviders = !providersLoading && ttsProviders.length === 0
  // One staged video keeps the legacy single flow; several fan out over the
  // shared config (no Single/Batch toggle, no separate batch view).
  const single = staged.length === 1 ? staged[0] : null

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
    <>
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
              {staged.some((s) => s.uploadStatus === 'ready') && (
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
                staged.length > 0 && 'has-file !border-none !bg-transparent !p-0',
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
                void handleFiles(Array.from(e.dataTransfer.files ?? []))
              }}
              onClick={() => !upload.isPending && staged.length === 0 && fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && staged.length === 0) fileRef.current?.click()
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                data-testid="single-file-input"
                onChange={(e) => {
                  void handleFiles(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
              {staged.length === 0 ? (
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
              ) : (
                <div className="flex flex-col gap-0.25">
                  {staged.map((s) => (
                    <div
                      key={s.key}
                      className="media-uploaded-preview batch-file-row group relative flex items-center gap-3 p-3 rounded-xl bg-[var(--color-media-soft)] transition-colors"
                      data-testid="staged-row"
                      data-status={s.uploadStatus}
                    >
                      <div className="media-dropzone-icon shrink-0 !w-9 !h-9 !rounded-lg !mb-0 bg-[var(--color-bg-surface)] text-[var(--color-media)] shadow-sm">
                        <IconVideo size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs text-[var(--color-text-primary)] truncate" title={s.fileName}>
                          {s.fileName}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                          {(s.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
                          {s.durationMs != null && ` · ${formatDurationMs(s.durationMs)}`}
                          {s.uploadStatus === 'uploading' && ` · ${s.progress}%`}
                        </div>
                        {s.error && (
                          <div className="text-[11px] text-[var(--color-error)]">{s.error}</div>
                        )}
                        {s.jobId && (
                          <div className="mt-0.5">
                            <Link
                              to={`/w/${workspaceId}/media/jobs/${s.jobId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] font-semibold text-[var(--color-media)]"
                            >
                              {t('media:batch.viewJob')}
                            </Link>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {s.createStatus === 'created' && (
                          <IconCheck size={16} className="shrink-0 text-[var(--color-status-completed)]" />
                        )}
                        {!batchCreating && s.uploadStatus !== 'uploading' && s.createStatus !== 'creating' && (
                          <button
                            type="button"
                            className="batch-file-remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center justify-center w-7 h-7 rounded-lg text-[var(--color-text-secondary)] hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-400 transition-colors cursor-pointer"
                            aria-label={t('media:batch.removeRow')}
                            onClick={(e) => {
                              e.stopPropagation()
                              removeStaged(s.key)
                            }}
                          >
                            <IconTrash size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
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

            {staged.length > 0 && (
              <div className="media-change-file-row mt-2.5 pt-2 border-t border-[var(--color-border)] flex justify-end">
                <button
                  type="button"
                  className="btn-secondary btn-sm media-change-file-btn text-xs py-1 px-2.5 inline-flex items-center gap-1.5"
                  data-testid="batch-add-more"
                  onClick={() => fileRef.current?.click()}
                >
                  <IconUpload size={13} />
                  {t('media:batch.addMoreFiles')}
                </button>
              </div>
            )}
          </div>

          {/* Group Divider */}
          <div className="my-3.5 border-t border-[var(--color-border)]" />

          {/* Step 2: Consent */}
          <div className={cn('media-aside-subcard', staged.length === 0 && 'opacity-60')}>
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
                  disabled={staged.length === 0 || consented}
                  data-testid="consent-check"
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
                  disabled={staged.length === 0 || !consentChecked || consenting}
                  data-testid="consent-confirm"
                  onClick={() => void handleConsent()}
                >
                  {consenting ? t('common:loading') : t('media:consentButton')}
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
                {single ? (
                  <span className="media-source-pill">
                    <IconVideo size={13} />
                    <span className="max-w-[200px] truncate">{single.fileName}</span>
                    {single.durationMs != null && (
                      <span className="opacity-75">· {formatDurationMs(single.durationMs)}</span>
                    )}
                  </span>
                ) : staged.length > 1 ? (
                  <span className="media-source-pill">
                    <IconVideo size={13} />
                    <span>{staged.length} {language === 'vi' ? 'video' : 'videos'}</span>
                  </span>
                ) : null}
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
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                  <IconLanguage size={14} className="text-[var(--color-media)]" />
                  {t('media:targetLangLabel')} <span className="text-[var(--color-accent)]">*</span>
                </span>

                <div className="relative mt-1.5" ref={targetDropdownRef}>
                  <button
                    type="button"
                    className={cn(
                      'field-input w-full flex items-center justify-between text-left cursor-pointer transition-colors',
                      targetDropdownOpen && 'border-[var(--color-media)] ring-1 ring-[var(--color-media)]',
                    )}
                    disabled={batchCreating}
                    data-testid="target-dropdown-trigger"
                    aria-haspopup="listbox"
                    aria-expanded={targetDropdownOpen}
                    onClick={() => setTargetDropdownOpen((prev) => !prev)}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
                      {selectedTargets.length === 1 ? (
                        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                          {formatLanguageOption(selectedTargets[0], language)}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-media-soft)] text-[var(--color-media)]">
                            {language === 'vi' ? `${selectedTargets.length} ngôn ngữ` : `${selectedTargets.length} languages`}
                          </span>
                          <span className="text-xs text-[var(--color-text-secondary)] truncate">
                            {selectedTargets.map((l) => l.toUpperCase()).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                    <IconChevronDown
                      size={16}
                      className={cn(
                        'text-[var(--color-text-tertiary)] shrink-0 ml-2 transition-transform duration-150',
                        targetDropdownOpen && 'rotate-180',
                      )}
                    />
                  </button>

                  <div
                    className={cn(
                      'absolute left-0 right-0 top-full mt-1.5 z-40 max-h-64 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1.5 shadow-xl',
                      !targetDropdownOpen && 'hidden',
                    )}
                    data-testid="target-checkboxes"
                    role="group"
                    aria-label={t('media:targetLangLabel')}
                  >
                    <div className="px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text-tertiary)] flex justify-between items-center border-b border-[var(--color-border)] mb-1">
                      <span>{language === 'vi' ? 'Chọn ngôn ngữ đích' : 'Select target languages'}</span>
                      <span className="font-mono text-[10px]">{selectedTargets.length} / {LANG_OPTIONS.length}</span>
                    </div>
                    <div className="space-y-0.5">
                      {LANG_OPTIONS.map((lang) => {
                        const checked = selectedTargets.includes(lang)
                        const locked = staged.length > 1 && !checked
                        const isOnlyChecked = checked && selectedTargets.length === 1
                        const disabled = batchCreating || locked || isOnlyChecked

                        return (
                          <label
                            key={lang}
                            className={cn(
                              'flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-xs font-medium transition-colors select-none',
                              checked
                                ? 'bg-[var(--color-media-soft)] text-[var(--color-text-primary)] font-semibold'
                                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]',
                              disabled && 'opacity-60 cursor-not-allowed',
                            )}
                            title={
                              locked
                                ? t('media:batch.multiVideoLocksTarget')
                                : isOnlyChecked
                                  ? language === 'vi'
                                    ? 'Phải giữ lại tối thiểu 1 ngôn ngữ đích'
                                    : 'At least one target language is required'
                                  : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              className="rounded border-[var(--color-border-strong)] text-[var(--color-media)] focus:ring-[var(--color-media)] h-4 w-4 shrink-0"
                              checked={checked}
                              disabled={disabled}
                              data-testid={`target-check-${lang}`}
                              onChange={() => toggleTarget(lang)}
                            />
                            <span className="flex-1 min-w-0 truncate">
                              {formatLanguageOption(lang, language)}
                            </span>
                            {checked && (
                              <span className="text-[11px] font-semibold text-[var(--color-media)] shrink-0">
                                {language === 'vi' ? 'Đã chọn' : 'Selected'}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {selectedTargets.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="selected-target-chips">
                    {selectedTargets.map((lang) => (
                      <span
                        key={lang}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-media-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-media)] border border-color-mix(in srgb, var(--color-media) 20%, transparent)"
                      >
                        <span>{formatLanguageOption(lang, language)}</span>
                        {!batchCreating && selectedTargets.length > 1 && (
                          <button
                            type="button"
                            className="hover:text-[var(--color-text-primary)] ml-0.5 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleTarget(lang)
                            }}
                            aria-label={`Remove ${lang}`}
                          >
                            <IconX size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                <span className="field-help text-[11px] mt-1 block">
                  {language === 'vi' ? 'Ngôn ngữ đích cho phụ đề và lồng tiếng' : 'Target language for subtitles & dubbing'}
                </span>
                {staged.length > 1 && (
                  <span className="field-help text-[11px] mt-1 block">
                    {t('media:batch.multiVideoLocksTarget')}
                  </span>
                )}
              </div>
            </div>

            {/* Voice configuration */}
            <div className="mt-3.5">
              {!isMultiTarget && (
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
                      targetLang={selectedTargets[0]}
                      selectedProviderId={voiceSelection.providerId}
                      selectedVoiceId={voiceSelection.voiceId}
                      disabled={!consented}
                      autoSelect
                      showPreview
                      allowOriginal={recipeId !== 'summary.generative'}
                      originalSelected={keepOriginalAudio}
                      onChange={(selection) => {
                        setVoiceSelection(selection)
                      }}
                      onOriginalChange={setKeepOriginalAudio}
                      onPendingChange={setVoiceSelection}
                    />
                  )}
                </div>
              )}
              {isMultiTarget && (
                <>
                  <label className="audio-original-toggle mt-3">
                    <input
                      type="checkbox"
                      data-testid="multi-keep-original"
                      checked={keepOriginalAudio}
                      disabled={batchCreating}
                      onChange={(e) => setKeepOriginalAudio(e.target.checked)}
                    />
                    <span>
                      <strong>{t('media:voice.original')}</strong>
                      <small>{t('media:batch.keepOriginalHint')}</small>
                    </span>
                  </label>
                  <div className="mt-3 space-y-3">
                    {selectedTargets.map((lang) => (
                      <div
                        key={lang}
                        className="media-config-block"
                        data-testid="multi-target-row"
                        data-lang={lang}
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                            {formatLanguageOption(lang, language)}
                          </span>
                          <span className="text-[11px] text-[var(--color-text-tertiary)]">
                            {targetJobs[lang]?.status === 'created'
                              ? t('media:batch.status.created')
                              : targetJobs[lang]?.status === 'failed'
                                ? t('media:batch.status.failed')
                                : null}
                          </span>
                          <span className="flex-1" />
                          {targetJobs[lang]?.jobId && (
                            <Link
                              to={`/w/${workspaceId}/media/jobs/${targetJobs[lang]?.jobId}`}
                              className="text-xs font-semibold text-[var(--color-media)]"
                            >
                              {t('media:batch.viewJob')}
                            </Link>
                          )}
                          {targetJobs[lang]?.status === 'created' && (
                            <IconCheck size={15} className="shrink-0 text-[var(--color-status-completed)]" />
                          )}
                        </div>
                        {!keepOriginalAudio
                          && !(presetProvidesVoice
                            && (targetVoices[lang]?.providerId == null)
                            && (targetVoices[lang]?.voiceId == null)) && (
                          <VoiceSelector
                            workspaceId={workspaceId}
                            providers={ttsProviders}
                            targetLang={lang}
                            selectedProviderId={targetVoices[lang]?.providerId ?? null}
                            selectedVoiceId={targetVoices[lang]?.voiceId ?? null}
                            disabled={batchCreating}
                            autoSelect
                            allowOriginal={false}
                            onChange={(selection) =>
                              setTargetVoices((prev) => ({ ...prev, [lang]: selection }))
                            }
                            onPendingChange={(selection) =>
                              setTargetVoices((prev) => ({ ...prev, [lang]: selection }))
                            }
                          />
                        )}
                        {targetJobs[lang]?.error && (
                          <div className="mt-1 text-[11px] text-[var(--color-error)]">
                            {targetJobs[lang]?.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
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
                    {single?.durationMs != null && (
                      <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-mono font-medium text-[var(--color-media)] bg-[var(--color-media-soft)] px-2.5 py-1 rounded-md">
                        <IconVideo size={13} />
                        {language === 'vi' ? 'Độ dài nguồn' : 'Source length'}: {formatDurationMs(single.durationMs)}
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
                {isMultiTarget
                  ? `${formatLanguageOption(selectedTargets[0], language)} +${selectedTargets.length - 1}`
                  : formatLanguageOption(selectedTargets[0] ?? 'vi', language)}
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

          {batchSummary && !batchCreating && (staged.length > 1 || isMultiTarget) && (
            <div
              className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-sm"
              data-testid="staged-summary"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--color-status-completed)] flex items-center gap-1.5">
                  <IconCheck size={16} className="shrink-0" />
                  <span>
                    {language === 'vi'
                      ? `${batchSummary.created}/${staged.length > 1 ? staged.length : selectedTargets.length} jobs thành công`
                      : `${batchSummary.created}/${staged.length > 1 ? staged.length : selectedTargets.length} jobs created`}
                  </span>
                </span>
                {batchSummary.failed > 0 && (
                  <span className="font-semibold text-[var(--color-error)] flex items-center gap-1">
                    · <span>{language === 'vi' ? `${batchSummary.failed} jobs thất bại` : `${batchSummary.failed} failed`}</span>
                  </span>
                )}
              </div>
              {batchSummary.created > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onCreated?.('')
                    navigate(`/w/${workspaceId}/media?project=${projectId}#overview`)
                  }}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] flex items-center gap-1.5 cursor-pointer ml-auto"
                >
                  <IconLoader2 size={13} className="animate-spin text-[var(--color-media)] shrink-0" />
                  <span>
                    {language === 'vi'
                      ? `Đang chuyển hướng (${redirectCountdown ?? 3}s)... (Redirecting)`
                      : `Redirecting... (${redirectCountdown ?? 3}s)`}
                  </span>
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[var(--color-text-tertiary)]">
              {!isMultiTarget && missingVoicePair && !noTtsProviders && (
                <span className="text-[var(--color-warning)] flex items-center gap-1">
                  <IconAlertCircle size={14} />
                  {language === 'vi'
                    ? 'Vui lòng chọn đủ Provider và Giọng đọc trước khi tạo job.'
                    : 'Please select both Provider and Voice before creating the job.'}
                </span>
              )}
              {isMultiTarget && selectedTargets.some((lang) => targetBlocked(lang)) && !noTtsProviders && (
                <span className="text-[var(--color-warning)] flex items-center gap-1">
                  <IconAlertCircle size={14} />
                  {t('media:batch.missingVoice')}
                </span>
              )}
              {isNxN && (
                <span className="text-[var(--color-warning)] flex items-center gap-1" data-testid="nxn-hint">
                  <IconAlertTriangle size={14} />
                  {t('media:batch.noNxN')}
                </span>
              )}
              {noTtsProviders && recipeId !== 'summary.generative' && !keepOriginalAudio && (
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
              data-testid="create-submit"
              disabled={
                !consented
                || selectedTargets.length === 0
                || createJob.isPending
                || batchCreating
                || selectedModeBlock.kind !== 'ok'
                || isNxN
                || (isMultiTarget
                  ? selectedTargets.some((lang) => targetBlocked(lang))
                  : missingVoicePair)
                || providersLoading
                || (recipeId !== 'summary.generative' && !keepOriginalAudio && noTtsProviders)
              }
              onClick={() => void handleCreate()}
            >
              {createJob.isPending || batchCreating ? (
                <IconLoader2 size={16} className="animate-spin" />
              ) : (
                <IconPlus size={16} />
              )}
              {createJob.isPending || batchCreating
                ? t('common:loading')
                : batchSummary
                  && batchSummary.failed > 0
                  && (staged.length > 1 || isMultiTarget)
                  ? t('media:batch.retryFailed')
                  : t('media:createJobSubmit')}
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
    </>
  )
}

export type CreateJobSelection = LocalizationJobPayloadInput & {
  deps: {
    createJob: {
      mutateAsync: (body: {
        documentId: string
        recipeId: string
        sourceLang?: string
        targetLang: string
        workflowMode?: WorkflowMode
        workflowPresetId?: string | null
        skipPresetResolution?: boolean | null
        requestedDurationSeconds: number | null
        requestedMode: AudioExecutionMode | null
        ttsProviderId?: string | null
        ttsVoiceId?: string | null
        keepOriginalAudio?: boolean
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
 * - picker "no preset" (workflowPresetId null/undefined) opts OUT of backend
 *   default resolution (skipPresetResolution: true) — the job falls back to
 *   recipe-derived defaults instead of auto-applying the workspace/system
 *   default preset. A pinned preset id always sends false.
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
  // Payload rules live in the shared batch helper (single source of truth for
  // single + batch creates); this wrapper only submits. Behavior unchanged.
  return selection.deps.createJob.mutateAsync(buildLocalizationCreateJobInput(selection))
}
