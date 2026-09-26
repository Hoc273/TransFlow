import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconDownload,
  IconListDetails,
  IconRefresh,
  IconRocket,
  IconScissors,
  IconShieldExclamation,
  IconShieldLock,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { CancelJobModal } from '@/components/media-studio/CancelJobModal'
import { ExportPanel } from '@/components/media-studio/ExportPanel'
import { qaBadgeSummary } from '@/components/media-studio/MediaQaPanel'
import { MediaReviewSection } from '@/components/media-studio/MediaReviewSection'
import { PipelineStepper } from '@/components/media-studio/PipelineStepper'
import { RenderAndVoiceSection } from '@/components/media-studio/RenderAndVoiceSection'
import { StageRerunDropdown } from '@/components/media-studio/StageRerunDropdown'
import { WorkflowCheckpointActions } from '@/components/media-studio/WorkflowCheckpointActions'
import { ProposalPanel } from '@/components/media-studio/ProposalPanel'
import { SourceLangModal } from '@/components/media-studio/SourceLangModal'
import { StudioTabs, type StudioPanel } from '@/components/media-studio/StudioTabs'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  useCancelMediaJob,
  useMediaAsset,
  useMediaJob,
  useMediaJobQaIssues,
  useMediaLinkedJob,
  useOverrideSourceLang,
  useRerunStage,
  useSelectVoice,
} from '@/hooks/useMedia'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { useRecordProjectVisit } from '@/hooks/useRecentProjects'
import { useTtsProviderOptions, useTtsVoices } from '@/hooks/useProviders'
import { useWorkflowPresets } from '@/hooks/useWorkflowPresets'
import { presetScopeLabelKey } from '@/components/media-studio/WorkflowPresetPicker'
import {
  scrollSectionIntoView,
  useWorkflowAutoScroll,
  type WorkflowScrollMilestone,
} from '@/hooks/useWorkflowAutoScroll'
import {
  filterCompatibleActiveVoices,
  isTtsProvider,
} from '@/lib/media/voiceSelection'
import type { ProviderConfig, TtsVoice } from '@/types/provider'
import {
  currentStage,
  domainPhaseLabelKey,
  isActiveMediaJobStatus,
  isAwaitingPlanSelection,
  isCancellableMediaJob,
  isLocalizationRecipe,
  isRedundantPhaseBadge,
  isRenderWaitingForQa,
  overallProgress,
  recipeLabelKey,
  recipeModeBadgeClass,
  recipePlanPanelKind,
  renderBlockingIssues,
  resolveEffectivePhase,
  resolveWorkflowMode,
} from '@/lib/media'
import { formatDateTimeDetailed } from '@/lib/format'
import { formatLanguageOption } from '@/lib/languages'
import { asJobStatus } from '@/lib/status'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/**
 * Media Job Studio — pinned pipeline stepper + numbered horizontal tabs.
 * Pipeline tracking lives only in the pinned card (not duplicated in tabs).
 */
export function MediaJobPage() {
  const { t } = useTranslation(['media', 'common'])
  const { workspaceId = '', jobId = '' } = useParams()
  const language = useUiStore((s) => s.language)
  const canCancel = usePermission('job.start')
  const canEdit = usePermission('job.start')

  const { data: job, isLoading, isError, error, isFetching, dataUpdatedAt, refetch } =
    useMediaJob(workspaceId, jobId)

  // QA summary for the review tab (count + worst tone).
  const { data: linkedJobForQa } = useMediaLinkedJob(workspaceId, job?.translationJobId)
  const { data: realQaIssues = [] } = useMediaJobQaIssues(workspaceId, jobId)
  const qaBadge = useMemo(() => {
    if (linkedJobForQa?.segments && linkedJobForQa.segments.length > 0) {
      return qaBadgeSummary(
        linkedJobForQa.segments.flatMap((s) => s.qaIssues ?? []),
      )
    }
    return qaBadgeSummary(realQaIssues)
  }, [linkedJobForQa, realQaIssues])

  const cancel = useCancelMediaJob(workspaceId, jobId)
  const overrideLang = useOverrideSourceLang(workspaceId, jobId)
  const selectVoice = useSelectVoice(workspaceId, jobId)
  const rerunStage = useRerunStage(workspaceId, jobId)

  const [openPanel, setOpenPanel] = useState<string>('overview')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [langModalOpen, setLangModalOpen] = useState(false)
  const [langError, setLangError] = useState<string | null>(null)

  // W4-R4: synchronous voice-change operation lock. React state
  // (selectVoice.isPending) updates asynchronously — two rapid events before a
  // re-render could both pass that guard and double-publish. The ref is set
  // synchronously in the handler and released only when the mutation settles.
  const voiceChangeLockRef = useRef(false)

  // Page heading = the source video's file name (existing asset endpoint).
  const { data: rootAsset } = useMediaAsset(workspaceId, job?.rootAssetId)
  const assetTitle = rootAsset?.fileName?.replace(/\.[a-z0-9]{2,4}$/i, '') || null

  useDocumentTitle(
    assetTitle ?? (job ? `Media ${job.id.slice(0, 8)}` : t('media:pipeline.title')),
  )

  // BYOK keys first, then the shared platform keys.
  const { data: ttsProviders } = useTtsProviderOptions(workspaceId)

  // Opening a job counts as visiting its project (sidebar "Recent").
  useRecordProjectVisit(workspaceId, job?.projectId)

  // Preset badge (admin milestone): resolve the frozen preset name for display.
  // The preset id is reference metadata only — never mutates job behavior.
  // BA review v1 P2: raw/reduced UUIDs are never rendered — when the job has
  // no preset (or the name cannot be resolved) the row shows "Không" instead
  // of being hidden.
  // backend-main returns the frozen reference as `presetId`; `workflowPresetId` is the legacy alias.
  const jobPresetId = job?.workflowPresetId ?? job?.presetId ?? null
  const { data: jobPresets = [] } = useWorkflowPresets(
    workspaceId,
    job?.projectId,
    Boolean(jobPresetId),
  )
  const presetName = useMemo(() => {
    if (!jobPresetId) return null
    const preset = jobPresets.find((p) => p.id === jobPresetId)
    // "Hệ thống: Social Media Shorts / Reels" — scope first so SYSTEM templates read apart from own presets.
    return preset ? `${t(presetScopeLabelKey(preset.scope))}: ${preset.name}` : null
  }, [jobPresetId, jobPresets, t])

  // Phase C: a bound job's provider is authoritative — never replaced by the
  // current workspace default. Legacy jobs (null ttsProviderId) fall back to
  // the workspace default for display only; they stay unbound until the user
  // explicitly changes the selection.
  const voiceProviderId = resolveJobVoiceProviderId(job, ttsProviders)
  const voiceProvider = ttsProviders.find((p) => p.id === voiceProviderId)
  const { data: voices = [] } = useTtsVoices(workspaceId, voiceProviderId ?? undefined, voiceProvider?.source)
  const availableVoices = filterCompatibleActiveVoices(voices, job?.targetLang)

  const stage = job ? currentStage(job) : null
  const progress = job ? overallProgress(job) : 0
  const phase = job ? resolveEffectivePhase(job) : null
  const cancellable = isCancellableMediaJob(job)
  const waitingCancel = job?.stages.some(
    (s) => String(s.status).toUpperCase() === 'CANCEL_REQUESTED',
  )
  const isLocalization = job ? isLocalizationRecipe(job) : false
  const workflowMode = job ? resolveWorkflowMode(job) : 'AUTO'

  // Summary recipes (extractive / generative) pause after SUMMARIZE until a plan is selected.
  // Driven by recipeId + stages — not processingMode (generative may still report HYBRID).
  const awaitProposalSelection = useMemo(
    () => (job ? isAwaitingPlanSelection(job) : false),
    [job],
  )
  const planPanelKind = useMemo(
    () => (job ? recipePlanPanelKind(job) : 'trim'),
    [job],
  )
  const userToggledRef = useRef(false)

  const openSection = useCallback((id: string) => {
    setOpenPanel(id)
    // Defer scroll until the section is marked open in the DOM.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => scrollSectionIntoView(id))
    }
  }, [])

  const handleScrollMilestone = useCallback(
    (milestone: WorkflowScrollMilestone) => {
      // Localization UX milestones; other recipes only auto-open proposals (below).
      if (milestone === 'stt-completed') {
        openSection('overview')
        return
      }
      if (milestone === 'translate-completed') {
        // W4-R3: QA + subtitles live in one review section for cross-checking.
        openSection('review')
        return
      }
      if (milestone === 'render-completed') {
        openSection('export')
      }
    },
    [openSection],
  )

  useWorkflowAutoScroll(job, { onMilestone: handleScrollMilestone })

  // RENDER held by QA (backend-owned signal): open Review once per wait so the
  // blocking issues are in front of the user instead of a silent PENDING stage.
  const waitingForQa = isRenderWaitingForQa(job)
  const qaBlockingCount = useMemo(() => renderBlockingIssues(realQaIssues).length, [realQaIssues])
  const openedForQaRef = useRef(false)
  useEffect(() => {
    if (!waitingForQa) {
      openedForQaRef.current = false
      return
    }
    if (!openedForQaRef.current && !userToggledRef.current) {
      openedForQaRef.current = true
      openSection('review')
    }
  }, [waitingForQa, openSection])

  useEffect(() => {
    // Summary recipes still auto-open the plan panel when selection is needed.
    if (isLocalization) return
    if (awaitProposalSelection && !userToggledRef.current) {
      setOpenPanel('proposals')
    }
  }, [awaitProposalSelection, isLocalization])

  const handleVoiceSelection = useCallback(
    (selection: { providerId: string | null; voiceId: string | null }) => {
      if (voiceChangeLockRef.current || selectVoice.isPending) return
      const payload = jobVoiceChangePayload(selection)
      if (!payload) return
      // W4-R4: re-selecting the exact current binding is a no-op — no API call,
      // no spurious rerun (the backend guards idempotently as well).
      if (isSameVoiceBinding(job, payload)) return
      voiceChangeLockRef.current = true
      setPanelError(null)
      // Voice selection requests backend voice selection; downstream rerun
      // semantics are governed by backend workflow.
      void selectVoice
        .mutateAsync(payload)
        .catch((e) =>
          setPanelError(e instanceof ApiError ? e.message : t('common:error.generic')),
        )
        .finally(() => {
          voiceChangeLockRef.current = false
        })
    },
    [job, selectVoice, t],
  )

  const selectedVoiceDisplay = useMemo(
    () => resolveJobVoiceDisplay(job, voices, t('media:voice.original')),
    [job, voices, t],
  )

  // A language change re-runs TRANSLATE → TTS → RENDER; the dialog warns when
  // anything already ran (the dialog itself is the confirmation step).
  const langChangeWillRerun = Boolean(
    job?.stages.some((s) => {
      const st = String(s.status).toUpperCase()
      return st !== 'PENDING' && st !== 'SKIPPED'
    }),
  )

  const submitLangOverride = useCallback(
    (sourceLang: string) => {
      setLangError(null)
      return overrideLang
        .mutateAsync({ sourceLang })
        .then(() => setLangModalOpen(false))
        .catch((e) =>
          setLangError(e instanceof ApiError ? e.message : t('common:error.generic')),
        )
    },
    [overrideLang, t],
  )

  const handleRerunStage = useCallback(
    async (stageName: string) => {
      setPanelError(null)
      try {
        await rerunStage.mutateAsync(stageName)
      } catch (e) {
        setPanelError(e instanceof ApiError ? e.message : t('common:error.generic'))
      }
    },
    [rerunStage, t],
  )

  const panels: StudioPanel[] = useMemo(() => {
    if (!job) return []

    // Tab step markers — derived only from backend stage statuses / signals.
    const stageDone = (name: string) =>
      job.stages.some(
        (s) => s.stageName === name && String(s.status).toUpperCase() === 'COMPLETED',
      )
    const renderDone = stageDone('RENDER')

    const sourceLangLabel = job.sourceLanguage
      ? formatLanguageOption(job.sourceLanguage, language)
      : t('media:pipeline.autoDetect')

    const overviewChildren = (
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm"
        data-testid="job-overview-section"
        data-recipe-id={job.recipeId}
      >
        <Info
          label={t('media:col.targetLang')}
          value={formatLanguageOption(job.targetLang, language)}
        />
        <Info
          label={t('media:pipeline.sourceLang')}
          action={
            canEdit ? (
              <button
                type="button"
                className="btn-link text-xs"
                data-testid="source-lang-edit"
                onClick={() => {
                  setLangError(null)
                  setLangModalOpen(true)
                }}
              >
                {t('media:pipeline.changeSourceLang')}
              </button>
            ) : undefined
          }
          value={sourceLangLabel}
        />
        <Info
          label={t('media:subtitleModeLabel')}
          value={
            job.subtitleMode === 'HARD_SUB' ? t('media:subtitleHard') : t('media:subtitleSoft')
          }
        />
        <Info
          label={t('media:create.durationLabel')}
          value={
            job.requestedDurationSeconds != null
              ? `${job.requestedDurationSeconds}s`
              : isLocalization
                ? t('media:fullVideoDuration')
                : '—'
          }
        />
        <Info
          label={t('media:workflowPreset.label')}
          value={presetName ?? t('media:workflowPreset.noPreset')}
        />
        <Info
          label={t('media:voice.selected')}
          value={selectedVoiceDisplay.text}
          mono={selectedVoiceDisplay.isMono}
        />
      </div>
    )

    const result: StudioPanel[] = [
      {
        id: 'overview',
        index: 1,
        title: t('media:panels.jobOverview'),
        subtitle: t('media:panels.jobOverviewSub'),
        icon: <IconListDetails size={16} />,
        children: overviewChildren,
      },
    ]

    // Summary recipes keep a standalone plan panel. Localization folds CUT into overview.
    if (!isLocalization) {
      result.push({
        id: 'proposals',
        index: 2,
        title:
          planPanelKind === 'narrative_plan'
            ? t('media:panels.narrativePlan')
            : planPanelKind === 'cut_plan'
              ? t('media:panels.proposals')
              : t('media:panels.trim'),
        subtitle:
          planPanelKind === 'narrative_plan'
            ? t('media:panels.narrativePlanSub')
            : planPanelKind === 'cut_plan'
              ? t('media:panels.proposalsSub')
              : t('media:panels.trimSub'),
        icon: <IconScissors size={16} />,
        status: awaitProposalSelection
          ? 'attention'
          : stageDone('SUMMARIZE') && (job.selectedProposalId || renderDone)
            ? 'done'
            : null,
        badge: awaitProposalSelection ? (
          <span className="media-action-needed-pill">
            {t('media:waitingForProposal.badge')}
          </span>
        ) : undefined,
        children: <ProposalPanel workspaceId={workspaceId} job={job} />,
      })
    }

    let nextIndex = result.length + 1

    result.push({
      id: 'review',
      index: nextIndex++,
      title: t('media:panels.review'),
      subtitle: t('media:panels.reviewSub'),
      icon: <IconShieldLock size={16} />,
      status: waitingForQa ? 'attention' : renderDone ? 'done' : null,
      badge:
        qaBadge.high + qaBadge.medium + qaBadge.low > 0 ? (
          <span className="qa-trigger-badge" data-testid="review-qa-badge">
            {qaBadge.high > 0 && (
              <span className="qa-seg qa-seg-critical" title={t('media:qa.band.high')}>
                {qaBadge.high}
              </span>
            )}
            {qaBadge.medium > 0 && (
              <span className="qa-seg qa-seg-warning" title={t('media:qa.band.medium')}>
                {qaBadge.medium}
              </span>
            )}
            {qaBadge.low > 0 && (
              <span className="qa-seg qa-seg-ok" title={t('media:qa.band.low')}>
                {qaBadge.low}
              </span>
            )}
          </span>
        ) : undefined,
      children: (
        <MediaReviewSection
          workspaceId={workspaceId}
          job={job}
          onProceedToNextStep={() => openSection('finish-render')}
        />
      ),
    })

    // Finish & Render: Aggregate TTS / AUDIO_MIX / RENDER + voice + style + prep into one section across recipes.
    result.push({
      id: 'finish-render',
      index: nextIndex++,
      title: t('media:panels.finishRender'),
      subtitle: t('media:panels.finishRenderSub'),
      icon: <IconRocket size={16} />,
      status: renderDone ? 'done' : null,
      children: (
        <RenderAndVoiceSection
          workspaceId={workspaceId}
          job={job}
          providers={ttsProviders}
          provider={voiceProvider}
          voices={availableVoices}
          selectedProviderId={voiceProviderId}
          canEdit={canEdit}
          selectVoicePending={selectVoice.isPending}
          onVoiceChange={handleVoiceSelection}
        />
      ),
    })

    result.push({
      id: 'export',
      index: nextIndex,
      title: t('media:panels.export'),
      subtitle: t('media:panels.exportSub'),
      icon: <IconDownload size={16} />,
      status: renderDone ? 'done' : null,
      children: <ExportPanel workspaceId={workspaceId} job={job} />,
    })

    return result
  }, [
    job,
    t,
    progress,
    canEdit,
    workspaceId,
    availableVoices,
    selectVoice.isPending,
    language,
    awaitProposalSelection,
    planPanelKind,
    voiceProvider,
    ttsProviders,
    voiceProviderId,
    isLocalization,
    workflowMode,
    qaBadge,
    waitingForQa,
    handleVoiceSelection,
    presetName,
    selectedVoiceDisplay,
  ])

  return (
    <div className="media-studio-page">
      <div className="page-header">
        <div className="min-w-0 flex-1">
          <div className="media-page-eyebrow">{t('media:pipeline.title')}</div>
          <h1 className="page-title min-w-0" title={assetTitle ?? undefined}>
            <IconVideo size={26} className="shrink-0 text-[var(--color-media)]" />
            <span className="truncate">{assetTitle ?? t('media:pipeline.title')}</span>
          </h1>
          <div className="page-subtitle flex flex-wrap items-center gap-2">
            {job && <StatusBadge status={asJobStatus(job.status)} />}
            {phase && !isRedundantPhaseBadge({ status: job?.status, domainPhase: phase }) && (
              <span
                className="media-domain-phase-badge"
                title={String(phase)}
              >
                {t(`media:${domainPhaseLabelKey(phase)}`, {
                  defaultValue: String(phase).replaceAll('_', ' '),
                })}
              </span>
            )}
            {job && (
              <span className={`media-mode-badge ${recipeModeBadgeClass(job)}`}>
                {t(`media:${recipeLabelKey(job)}`)}
              </span>
            )}
            {job && (
              <span className="media-lang-badge">
                {formatLanguageOption(job.targetLang, language)}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]"
              data-testid="job-updated-at"
              data-fetching={isFetching ? 'true' : 'false'}
            >
              <span
                className={`media-poll-dot ${
                  job && isActiveMediaJobStatus(job.status) ? 'pulse-dot' : ''
                }`}
                aria-hidden
              />
              {t('media:poll.updatedAt', {
                time: formatDateTimeDetailed(new Date(dataUpdatedAt).toISOString(), language),
              })}
            </span>
          )}
          <button
            type="button"
            className="btn-media-secondary"
            data-testid="job-refresh"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <IconRefresh size={16} className={isFetching ? 'animate-spin' : undefined} />
            {t('common:refresh')}
          </button>
          {canCancel && cancellable && (
            <button
              type="button"
              className="btn-danger-outline"
              onClick={() => setCancelOpen(true)}
            >
              <IconX size={16} />
              {t('media:cancel.button')}
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="app-card py-12 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common:loading')}
        </div>
      )}

      {isError && !isLoading && (
        <div className="app-card">
          <EmptyState
            icon={<IconVideo size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        </div>
      )}

      {job && !isLoading && (
        <>
          {String(job.status).toUpperCase() === 'PARTIALLY_FAILED' && (
            <div className="media-banner warn mb-4">
              <IconX size={18} />
              <p className="m-0 text-sm">{t('media:partialBanner')}</p>
            </div>
          )}

          {awaitProposalSelection && (
            <div className="media-banner info mb-4">
              <IconScissors size={18} />
              <p className="m-0 text-sm">
                {t(
                  planPanelKind === 'narrative_plan'
                    ? 'media:waitingForProposal.narrativeTitle'
                    : 'media:waitingForProposal.title',
                )}
                {' · '}
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setOpenPanel('proposals')}
                >
                  {t('media:waitingForProposal.cta')}
                </button>
              </p>
            </div>
          )}

          {waitingForQa && (
            <div className="media-banner warn mb-4" role="status" data-testid="qa-wait-banner">
              <IconShieldExclamation size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="m-0 text-sm font-semibold">
                  {qaBlockingCount > 0
                    ? t('media:qaWait.title', { count: qaBlockingCount })
                    : t('media:qaWait.titleUnknown')}
                </p>
                <p className="m-0 text-sm">{t('media:qaWait.body')}</p>
              </div>
              <button
                type="button"
                className="btn-media-secondary btn-sm shrink-0 whitespace-nowrap"
                data-testid="qa-wait-cta"
                onClick={() => openSection('review')}
              >
                {t('media:qaWait.cta')}
              </button>
            </div>
          )}

          {/* W0 workflow checkpoint actions (docs/19 §1.8.2) — only when actionable. */}
          <WorkflowCheckpointActions workspaceId={workspaceId} job={job} />

          <div className="app-card mb-4 overflow-visible">
            <div className="app-card-header relative z-20 flex flex-wrap items-center justify-between gap-2">
              <div className="app-card-title">{t('media:pipeline.stepperTitle')}</div>
              <div className="flex items-center gap-3">
                {stage && (
                  <span className="text-[11px] text-[var(--color-text-tertiary)]">
                    {t(`media:stages.${stage.stageName}`, {
                      defaultValue: stage.stageName.replaceAll('_', ' '),
                    })}
                    {' · '}
                    {progress}%
                  </span>
                )}
                {job && (
                  <StageRerunDropdown
                    job={job}
                    canEdit={canEdit}
                    onRerun={handleRerunStage}
                    isPending={rerunStage.isPending}
                  />
                )}
              </div>
            </div>
            <div className="app-card-body">
              <PipelineStepper job={job} />
              {waitingCancel && (
                <div className="media-banner warn mt-4">
                  <IconX size={18} />
                  <p className="m-0 text-sm">
                    {t('media:cancel.waiting', {
                      stage: stage
                        ? t(`media:stages.${stage.stageName}`, {
                            defaultValue: stage.stageName,
                          })
                        : '—',
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>

          {panelError && (
            <div
              role="alert"
              className="media-panel-error-toast"
              data-testid="panel-error-toast"
            >
              {panelError}
            </div>
          )}

          <StudioTabs
            panels={panels}
            activeId={openPanel}
            onSelect={(id) => {
              userToggledRef.current = true
              setOpenPanel(id)
            }}
          />

      <SourceLangModal
        open={langModalOpen}
        currentLang={job.sourceLanguage}
        uiLanguage={language}
        willRerun={langChangeWillRerun}
        loading={overrideLang.isPending}
        error={langError}
        onClose={() => setLangModalOpen(false)}
        onApply={(lang) => void submitLangOverride(lang)}
      />

      {cancelOpen && (
        <CancelJobModal
          open={cancelOpen}
          job={job}
          loading={cancel.isPending}
          onClose={() => setCancelOpen(false)}
          onConfirm={() => {
            void cancel
              .mutateAsync()
              .then(() => setCancelOpen(false))
              .catch((e) =>
                setPanelError(
                  e instanceof ApiError ? e.message : t('common:error.generic'),
                ),
              )
          }}
        />
      )}
    </>
  )}
</div>
)
}

export type JobVoiceChange = {
  /** All-or-nothing pair; nulls = deselect (keep original audio). */
  providerId: string | null
  voiceId: string | null
  /** Current job binding — W4-R4 same-binding no-op guard. */
  job?: {
    ttsProviderId?: string | null
    ttsVoiceId?: string | null
    voiceId?: string | null
  } | null
  deps: {
    selectVoice: { isPending: boolean; mutateAsync: (body: { providerId: string | null; voiceId: string | null }) => Promise<unknown> }
    onError: (message: string) => void
  }
}

/**
 * Phase C — resolve the provider to display for a job's voice panel.
 * A bound job's ttsProviderId is authoritative (never replaced by the current
 * workspace default); legacy jobs fall back to the workspace default for
 * display only and stay unbound until the user changes the selection.
 */
export function resolveJobVoiceProviderId(
  job: { ttsProviderId?: string | null } | null | undefined,
  providers: ProviderConfig[],
): string | null {
  const tts = providers.filter((p) => p.enabled && isTtsProvider(p))
  const bound = job?.ttsProviderId
  if (bound != null && tts.some((p) => p.id === bound)) return bound
  if (bound != null) return bound // dangling binding — surfaced read-only, no fallback
  return (
    tts.find((p) => p.defaultFor?.includes('TTS'))?.id
    ?? tts[0]?.id
    ?? null
  )
}

/**
 * Phase C — map a VoiceSelector emission to a Job Studio selectVoice payload.
 * Only complete pairs are allowed: (providerId+voiceId) or (null+null) for
 * deselect. A provider-only emission (mid provider-switch) returns null so the
 * caller skips the API call — the provider switch is never persisted as a
 * deselect (P1 fix — atomic provider+voice change at the UI-operation level).
 */
export function jobVoiceChangePayload(selection: {
  providerId: string | null
  voiceId: string | null
}): { providerId: string | null; voiceId: string | null } | null {
  const hasProvider = selection.providerId != null
  const hasVoice = selection.voiceId != null
  if (hasProvider !== hasVoice) return null
  return { providerId: selection.providerId, voiceId: selection.voiceId }
}

/**
 * W4-R4 — same-binding no-op guard: true when the payload equals the job's
 * current binding (authoritative pair, or legacy voiceId when unbound).
 * Re-selecting the current voice must never trigger a rerun.
 */
export function isSameVoiceBinding(
  job: {
    ttsProviderId?: string | null
    ttsVoiceId?: string | null
    voiceId?: string | null
  } | null | undefined,
  payload: { providerId: string | null; voiceId: string | null },
): boolean {
  if (!job) return false
  if (payload.providerId == null || payload.voiceId == null) {
    // Deselect: no-op when already fully unbound (authoritative + legacy).
    return (
      job.ttsProviderId == null &&
      job.ttsVoiceId == null &&
      (job.voiceId == null || job.voiceId.trim() === '')
    )
  }
  return job.ttsProviderId === payload.providerId && job.ttsVoiceId === payload.voiceId
}

/**
 * Phase C — Job Studio voice change through the authoritative backend
 * endpoint. Exported as a pure helper (repo pattern) so tests assert the
 * exact selectVoice payload without driving the accordion UI.
 */
export async function runJobVoiceChange(change: JobVoiceChange) {
  const { deps } = change
  if (deps.selectVoice.isPending) return
  const payload = jobVoiceChangePayload(change)
  if (!payload) return
  // W4-R4: re-selecting the exact current binding is a no-op — the backend
  // guards idempotently as well.
  if (isSameVoiceBinding(change.job, payload)) return
  await deps.selectVoice.mutateAsync(payload)
}

/**
 * Resolves the user-facing display name and font styling for the selected voice
 * in the Job Studio Overview section.
 *
 * Priority:
 * 1. Authoritative `ttsVoiceDisplayName` provided directly in the job response.
 * 2. Lookup by `ttsVoiceId` in cached catalog voices.
 * 3. Fallback to `voiceId`: if matching a voice row ID in cached voices, use its display name;
 *    otherwise display the raw string with monospace styling.
 * 4. Unbound fallback ('Giọng gốc' / 'Original voice') with normal styling.
 */
export function resolveJobVoiceDisplay(
  job: {
    ttsVoiceDisplayName?: string | null
    ttsVoiceId?: string | null
    voiceId?: string | null
  } | null | undefined,
  voices: TtsVoice[] = [],
  fallbackOriginal = 'Original voice',
): { text: string; isMono: boolean } {
  if (!job) return { text: fallbackOriginal, isMono: false }

  // 1. Authoritative display name from backend response (MediaJobResponse.ttsVoiceDisplayName)
  if (job.ttsVoiceDisplayName && job.ttsVoiceDisplayName.trim() !== '') {
    return { text: job.ttsVoiceDisplayName.trim(), isMono: false }
  }

  // 2. Authoritative voice row ID looked up in cached voices
  if (job.ttsVoiceId) {
    const matched = voices.find((v) => v.id === job.ttsVoiceId)
    // Catalog rows may carry only the provider voice code (e.g. "Ethan").
    const name = matched?.displayName?.trim() || matched?.voiceId?.trim()
    if (name) {
      return { text: name, isMono: false }
    }
  }

  // 3. Fallback to voiceId: if it matches a voice row UUID, use displayName; otherwise raw mono string
  if (job.voiceId && job.voiceId.trim() !== '') {
    const matched = voices.find((v) => v.id === job.voiceId)
    // Catalog rows may carry only the provider voice code (e.g. "Ethan").
    const name = matched?.displayName?.trim() || matched?.voiceId?.trim()
    if (name) {
      return { text: name, isMono: false }
    }
    return { text: job.voiceId.trim(), isMono: true }
  }

  if (job.ttsVoiceId) {
    return { text: job.ttsVoiceId, isMono: true }
  }

  // 4. Unbound / original voice
  return { text: fallbackOriginal, isMono: false }
}

function Info({
  label,
  value,
  mono,
  action,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
          {label}
        </div>
        {action}
      </div>
      <div className={`mt-1 text-sm ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</div>
    </div>
  )
}
