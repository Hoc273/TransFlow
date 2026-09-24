import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconDownload,
  IconGitBranch,
  IconListDetails,
  IconRefresh,
  IconRocket,
  IconScissors,
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
import { WorkflowCheckpointStrip } from '@/components/media-studio/WorkflowCheckpointStrip'
import { ProposalPanel } from '@/components/media-studio/ProposalPanel'
import { StageLegend } from '@/components/media-studio/StageLegend'
import { StudioAccordion, type StudioPanel } from '@/components/media-studio/StudioAccordion'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  useCancelMediaJob,
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
import { useProviders, useTtsVoices } from '@/hooks/useProviders'
import { useWorkflowPresets } from '@/hooks/useWorkflowPresets'
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
  overallProgress,
  recipeLabelKey,
  recipeModeBadgeClass,
  recipePlanPanelKind,
  resolveEffectivePhase,
  resolveWorkflowMode,
} from '@/lib/media'
import { formatRelativeTime } from '@/lib/format'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import { asJobStatus } from '@/lib/status'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/**
 * Media Job Studio — pinned pipeline stepper + numbered accordion panels.
 * Pipeline tracking lives only in the pinned card (not duplicated in accordion).
 */
export function MediaJobPage() {
  const { t } = useTranslation(['media', 'common'])
  const { workspaceId = '', jobId = '' } = useParams()
  const language = useUiStore((s) => s.language)
  const canCancel = usePermission('job.start')
  const canEdit = usePermission('job.start')

  const { data: job, isLoading, isError, error, isFetching, dataUpdatedAt, refetch } =
    useMediaJob(workspaceId, jobId)

  // QA summary for the review accordion trigger (count + worst tone).
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

  const [openPanel, setOpenPanel] = useState<string | null>('overview')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [sourceLangDraft, setSourceLangDraft] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)
  const [confirmLangChange, setConfirmLangChange] = useState(false)

  // W4-R4: synchronous voice-change operation lock. React state
  // (selectVoice.isPending) updates asynchronously — two rapid events before a
  // re-render could both pass that guard and double-publish. The ref is set
  // synchronously in the handler and released only when the mutation settles.
  const voiceChangeLockRef = useRef(false)

  useDocumentTitle(job ? `Media ${job.id.slice(0, 8)}` : t('media:pipeline.title'))

  const { data: providers = [] } = useProviders(workspaceId)
  const ttsProviders = providers.filter(isTtsProvider)

  // Opening a job counts as visiting its project (sidebar "Recent").
  useRecordProjectVisit(workspaceId, job?.projectId)

  // Preset badge (admin milestone): resolve the frozen preset name for display.
  // The preset id is reference metadata only — never mutates job behavior.
  // BA review v1 P2: raw/reduced UUIDs are never rendered — when the job has
  // no preset (or the name cannot be resolved) the row shows "Không" instead
  // of being hidden.
  const { data: jobPresets = [] } = useWorkflowPresets(
    workspaceId,
    job?.projectId,
    Boolean(job?.workflowPresetId),
  )
  const presetName = useMemo(() => {
    if (!job?.workflowPresetId) return null
    return (
      jobPresets.find((p) => p.id === job.workflowPresetId)?.name ?? null
    )
  }, [job, jobPresets])

  // Phase C: a bound job's provider is authoritative — never replaced by the
  // current workspace default. Legacy jobs (null ttsProviderId) fall back to
  // the workspace default for display only; they stay unbound until the user
  // explicitly changes the selection.
  const voiceProviderId = resolveJobVoiceProviderId(job, ttsProviders)
  const voiceProvider = ttsProviders.find((p) => p.id === voiceProviderId)
  const { data: voices = [] } = useTtsVoices(workspaceId, voiceProviderId ?? undefined)
  const availableVoices = filterCompatibleActiveVoices(voices, job?.targetLang)

  const selectedVoiceDisplay = useMemo(
    () => resolveJobVoiceDisplay(job, voices, t('media:voice.original')),
    [job, voices, t],
  )

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

  useEffect(() => {
    // Summary recipes still auto-open the plan panel when selection is needed.
    if (isLocalization) return
    if (awaitProposalSelection && !userToggledRef.current) {
      setOpenPanel('proposals')
    }
  }, [awaitProposalSelection, isLocalization])

  useEffect(() => {
    if (job?.sourceLanguage) {
      setSourceLangDraft(job.sourceLanguage)
    }
  }, [job?.sourceLanguage])

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

  const submitLangOverride = useCallback(() => {
    setConfirmLangChange(false)
    setPanelError(null)
    return overrideLang
      .mutateAsync({ sourceLang: sourceLangDraft.trim() })
      .catch((e) =>
        setPanelError(e instanceof ApiError ? e.message : t('common:error.generic')),
      )
  }, [overrideLang, sourceLangDraft, t])

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

    const overviewChildren = (
      <div
        className="space-y-4"
        data-testid="job-overview-section"
        data-recipe-id={job.recipeId}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <Info label={t('media:col.id')} value={job.id} mono />
          <Info label={t('media:col.mode')} value={t(`media:${recipeLabelKey(job)}`)} />
          <Info
            label={t('media:workflow.modeLabel')}
            value={
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  workflowMode === 'MANUAL'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                    : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20'
                }`}
              >
                {workflowMode === 'MANUAL' ? t('media:workflow.manual') : t('media:workflow.auto')}
              </span>
            }
          />
          <Info
            label={t('media:col.targetLang')}
            value={formatLanguageOption(job.targetLang, language)}
          />
          <Info
            label={t('media:pipeline.sourceLang')}
            value={
              job.sourceLanguage
                ? formatLanguageOption(job.sourceLanguage, language)
                : t('media:pipeline.autoDetect')
            }
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
            label={t('media:col.status')}
            value={<StatusBadge status={asJobStatus(job.status)} />}
          />
          <Info
            label={t('media:workflowPreset.label')}
            value={presetName ?? t('media:workflowPreset.noPreset')}
          />
          {phase && (
            <Info
              label={t('media:col.domainPhase')}
              value={t(`media:${domainPhaseLabelKey(phase)}`, {
                defaultValue: String(phase).replaceAll('_', ' '),
              })}
            />
          )}
          <Info
            label={t('media:pipeline.progress')}
            value={
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--color-bg-surface-3)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent)] transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs font-semibold tabular-nums">{progress}%</span>
              </div>
            }
          />
          <Info
            label={t('media:voice.selected')}
            value={selectedVoiceDisplay.text}
            mono={selectedVoiceDisplay.isMono}
          />
        </div>

        <div className="media-config-block">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            {t('media:pipeline.overrideLang')}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="field-label max-w-[220px] flex-1">
              <span>{t('media:pipeline.sourceLang')}</span>
              <select
                className="field-input"
                value={sourceLangDraft}
                onChange={(e) => setSourceLangDraft(e.target.value)}
                disabled={!canEdit}
              >
                <option value="">{t('media:pipeline.selectSourceLang')}</option>
                {LANG_OPTIONS.map((lang) => (
                  <option key={lang} value={lang}>
                    {formatLanguageOption(lang, language)}
                  </option>
                ))}
              </select>
            </label>
            {canEdit && (
              <button
                type="button"
                className="btn-secondary"
                disabled={!sourceLangDraft.trim() || overrideLang.isPending}
                onClick={() => {
                  setPanelError(null)
                  // A language change re-runs the translation pipeline (TRANSLATE →
                  // TTS → RENDER). When anything already ran, ask for explicit
                  // confirmation before rewinding the job.
                  const alreadyRan = job.stages.some((s) => {
                    const st = String(s.status).toUpperCase()
                    return st !== 'PENDING' && st !== 'SKIPPED'
                  })
                  if (alreadyRan) {
                    setConfirmLangChange(true)
                    return
                  }
                  void submitLangOverride()
                }}
              >
                {t('media:pipeline.applyLang')}
              </button>
            )}
          </div>
          {confirmLangChange && canEdit && (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-surface-2)] p-3"
              data-testid="lang-override-confirm"
            >
              <p className="m-0 flex-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                {t('media:pipeline.overrideConfirm')}
              </p>
              <button
                type="button"
                className="btn-danger-outline"
                disabled={overrideLang.isPending}
                onClick={() => setConfirmLangChange(false)}
              >
                {t('common:actions.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={overrideLang.isPending}
                data-testid="lang-override-confirm-apply"
                onClick={() => void submitLangOverride()}
              >
                {t('media:pipeline.overrideConfirmApply')}
              </button>
            </div>
          )}
          <p className="field-help mt-2 mb-0">{t('media:pipeline.staleWarn')}</p>
        </div>

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
      children: <ExportPanel workspaceId={workspaceId} job={job} />,
    })

    return result
  }, [
    job,
    t,
    progress,
    sourceLangDraft,
    canEdit,
    overrideLang,
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
    handleVoiceSelection,
    submitLangOverride,
    confirmLangChange,
    presetName,
  ])

  return (
    <div className="media-studio-page">
      <div className="page-header">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">
            <IconGitBranch size={26} className="text-[var(--color-media)]" />
            {t('media:pipeline.title')}
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
            {isFetching && (
              <span className="text-[var(--color-accent)]">{t('media:poll.updating')}</span>
            )}
            {dataUpdatedAt > 0 && (
              <span className="text-[var(--color-text-tertiary)]">
                {t('media:poll.updated', {
                  relative: formatRelativeTime(
                    new Date(dataUpdatedAt).toISOString(),
                    language,
                  ),
                })}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="media-poll-status">
            <span
              className={`media-poll-dot ${
                job && isActiveMediaJobStatus(job.status) ? 'pulse-dot' : ''
              }`}
            />
            <span>{t('media:poll.every5s')}</span>
          </div>
          <StageLegend />
          <button type="button" className="btn-media-secondary" onClick={() => void refetch()}>
            <IconRefresh size={16} />
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

          {/* W0 workflow checkpoint projection strip (docs/19 §1.8.2). */}
          <WorkflowCheckpointStrip workspaceId={workspaceId} job={job} />

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

          <StudioAccordion
            panels={panels}
            openId={openPanel}
            onToggle={(id) => {
              userToggledRef.current = true
              setOpenPanel((cur) => (cur === id ? null : id))
            }}
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
    if (matched && matched.displayName && matched.displayName.trim() !== '') {
      return { text: matched.displayName.trim(), isMono: false }
    }
  }

  // 3. Fallback to voiceId: if it matches a voice row UUID, use displayName; otherwise raw mono string
  if (job.voiceId && job.voiceId.trim() !== '') {
    const matched = voices.find((v) => v.id === job.voiceId)
    if (matched && matched.displayName && matched.displayName.trim() !== '') {
      return { text: matched.displayName.trim(), isMono: false }
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
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className={`mt-1 text-sm ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</div>
    </div>
  )
}
