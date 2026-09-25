import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconCheck,
  IconLoader2,
  IconLock,
  IconPlus,
  IconPlayerPlay,
  IconRefresh,
  IconScissors,
  IconSparkles,
  IconUserEdit,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { NarrativePlanViewer, type SourceDialogueSegment } from '@/components/media-studio/NarrativePlanViewer'
import {
  useCreateCustomProposal,
  useMediaLinkedJob,
  useMediaProposals,
  useRerunSummarize,
  useSelectProposal,
} from '@/hooks/useMedia'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/cn'
import {
  formatDurationMs,
  isAwaitingPlanSelection,
  isExtractiveRecipe,
  isGenerativeRecipe,
  isLegacyNarrativeReviewJob,
  isNarrativeProposal,
  isProposalSelectionLocked,
  isSelectedProposalActivated,
  isSinglePlanGenerativeJob,
  isSummaryRecipe,
  normalizeCutRanges,
  normalizeWarnings,
  resolvePlanStatus,
  resolveProposalPlanKind,
  resolveProposalSelectionUiState,
  type ProposalSelectionUiState,
} from '@/lib/media'
import { ApiError } from '@/types/api'
import type { MediaJob, MediaSummaryProposal } from '@/types/media'

type Props = {
  workspaceId: string
  job: MediaJob
}

export function ProposalPanel({ workspaceId, job }: Props) {
  const { t } = useTranslation(['media', 'common'])
  const canEdit = usePermission('job.start')
  const { data: linkedJob } = useMediaLinkedJob(workspaceId, job.translationJobId)
  const { data: proposals = [], isLoading, isError, error, refetch } = useMediaProposals(
    workspaceId,
    job.id,
  )
  const selectProposal = useSelectProposal(workspaceId, job.id)
  const createCustom = useCreateCustomProposal(workspaceId, job.id)
  const rerun = useRerunSummarize(workspaceId, job.id)

  const [selectedId, setSelectedId] = useState<string | null>(job.selectedProposalId)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [customStart, setCustomStart] = useState('0')
  const [customEnd, setCustomEnd] = useState('60')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [showCustomForm, setShowCustomForm] = useState(false)

  const aiProposals = useMemo(
    () => proposals.filter((p) => String(p.generated_by).toUpperCase() === 'AI'),
    [proposals],
  )
  const humanProposals = useMemo(
    () => proposals.filter((p) => String(p.generated_by).toUpperCase() === 'HUMAN'),
    [proposals],
  )

  // Recipe-first (not processingMode). Generative jobs may still report HYBRID in DB.
  const isExtractive = isExtractiveRecipe(job)
  const isGenerative = isGenerativeRecipe(job)
  const isSinglePlan = isSinglePlanGenerativeJob(job)
  const isLegacyGenerative = isLegacyNarrativeReviewJob(job)
  const isSummary = isSummaryRecipe(job)
  const selectionLocked = isProposalSelectionLocked(job) || activatingId !== null
  const activated = isSelectedProposalActivated(job)
  const needsSelection = isAwaitingPlanSelection(job)
  const summarizeDone = job.stages.some(
    (s) => s.stageName === 'SUMMARIZE' && String(s.status).toUpperCase() === 'COMPLETED',
  )
  // Rerun is blocked server-side when dependent segments exist; mirror that in UI.
  const rerunBlocked =
    selectionLocked &&
    (Boolean(job.translationJobId) ||
      job.stages.some(
        (s) =>
          s.stageName === 'TRANSLATE' &&
          ['PROCESSING', 'COMPLETED', 'STALE', 'FAILED'].includes(String(s.status).toUpperCase()),
      ))

  // Keep local selection in sync with job poll (source of truth).
  useEffect(() => {
    if (job.selectedProposalId) setSelectedId(job.selectedProposalId)
  }, [job.selectedProposalId])

  const activeSelectedId = selectedId ?? job.selectedProposalId

  // Optimistic state: while a select request is in flight, the clicked proposal
  // shows "activating" immediately — don't wait for BE poll to reflect the lock.
  const resolveSelectionState = (proposalId: string): ProposalSelectionUiState => {
    if (activatingId === proposalId) return 'activating'
    return resolveProposalSelectionUiState(job, proposalId)
  }

  const handleSelect = async (id: string) => {
    // Prevent duplicate select / re-activate once the job has a committed selection.
    if (selectionLocked || selectProposal.isPending) return
    if (job.selectedProposalId === id || selectedId === id) return

    setSelectedId(id)
    setActivatingId(id)
    setShowCustomForm(false)
    setFormError(null)
    try {
      await selectProposal.mutateAsync(id)
    } catch (e) {
      // Roll back optimistic local selection on failure.
      setSelectedId(job.selectedProposalId)
      setFormError(e instanceof ApiError ? e.message : t('common:error.generic'))
    } finally {
      setActivatingId(null)
    }
  }

  const handleCreateCustom = async () => {
    if (selectionLocked) return
    setFormError(null)
    const startMs = Math.round(Number(customStart) * 1000)
    const endMs = Math.round(Number(customEnd) * 1000)
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      setFormError(t('media:proposals.invalidRange'))
      return
    }
    try {
      const p = await createCustom.mutateAsync({
        cutRanges: [{ startMs, endMs }],
        reasoningNote: note.trim() || null,
      })
      setSelectedId(p.id)
      setShowCustomForm(false)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('common:error.generic'))
    }
  }

  if (!isSummary) {
    return (
      <div className="space-y-4">
        <div className="media-proposal-section">
          <div className="media-proposal-section-head">
            <div className="media-proposal-section-title">
              <IconScissors size={16} className="text-[var(--color-accent)]" />
              {t('media:trim.hint')}
            </div>
          </div>
          <div className="media-proposal-section-body space-y-3">
            <p className="mb-0 mt-0 text-sm text-[var(--color-text-secondary)]">
              {t('media:trim.optionalNote')}
            </p>
            <div className="media-config-grid cols-2">
              <div className="media-config-block">
                <label className="field-label">
                  <span>{t('media:trim.startSec')}</span>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    step={0.1}
                    value={customStart}
                    disabled={selectionLocked}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </label>
              </div>
              <div className="media-config-block">
                <label className="field-label">
                  <span>{t('media:trim.endSec')}</span>
                  <input
                    className="field-input"
                    type="number"
                    min={0}
                    step={0.1}
                    value={customEnd}
                    disabled={selectionLocked}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="media-config-block">
              <label className="field-label">
                <span>{t('media:proposals.note')}</span>
                <textarea
                  className="field-input min-h-[72px]"
                  value={note}
                  disabled={selectionLocked}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('media:proposals.notePlaceholder')}
                />
              </label>
            </div>
            {formError && <p className="mb-0 text-sm text-[var(--color-error)]">{formError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && !selectionLocked && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={createCustom.isPending}
                  onClick={() => void handleCreateCustom()}
                >
                  <IconScissors size={16} />
                  {t('media:trim.apply')}
                </button>
              )}
              {selectionLocked && (
                <span className="media-proposal-state-pill locked">
                  <IconLock size={12} />
                  {t('media:proposals.locked')}
                </span>
              )}
              <p className="mb-0 text-xs text-[var(--color-text-tertiary)]">
                {t('media:trim.skipHint')}
              </p>
            </div>
          </div>
        </div>

        {humanProposals.length > 0 && (
          <div className="media-proposal-section">
            <div className="media-proposal-section-head">
              <div className="media-proposal-section-title">
                <IconUserEdit size={16} />
                {t('media:proposals.customList')}
              </div>
            </div>
            <div className="media-proposal-section-body space-y-2">
              {humanProposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  job={job}
                  selectionState={resolveSelectionState(p.id)}
                  selectionLocked={selectionLocked}
                  requestedSec={job.requestedDurationSeconds}
                  onSelect={() => void handleSelect(p.id)}
                  busy={selectProposal.isPending}
                  canSelect={canEdit}
                  sourceSegments={linkedJob?.segments}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="media-proposal-section">
        <div className="media-proposal-section-head">
          <div className="media-proposal-section-title">
            <IconSparkles size={16} className="text-[var(--color-accent)]" />
            {t(
              isGenerative
                ? 'media:proposals.narrativeSection'
                : 'media:proposals.aiSection',
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {needsSelection && (
              <span className="media-action-needed-pill">
                {t('media:waitingForProposal.badge')}
              </span>
            )}
            {!isGenerative && selectionLocked && (
              <span className="media-proposal-state-pill locked">
                <IconLock size={12} />
                {activated
                  ? t('media:proposals.activatedLocked')
                  : t('media:proposals.locked')}
              </span>
            )}
            {isSinglePlan && canEdit && !selectionLocked && (
              <span className="media-proposal-state-pill">
                {t('media:proposals.singlePlanAuto')}
              </span>
            )}
            {isLegacyGenerative && needsSelection && (
              <span className="media-action-needed-pill">
                {t('media:waitingForProposal.badge')}
              </span>
            )}
            {canEdit && !isSinglePlan && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={rerun.isPending || !summarizeDone || rerunBlocked}
                title={
                  rerunBlocked
                    ? t('media:proposals.rerunBlocked')
                    : !summarizeDone
                      ? t('media:proposals.rerunDisabled')
                      : undefined
                }
                onClick={() => void rerun.mutateAsync().catch(() => undefined)}
              >
                <IconRefresh size={14} />
                {t('media:proposals.rerun')}
              </button>
            )}
          </div>
        </div>
        <div className="media-proposal-section-body">
          <p className="mb-3 mt-0 text-sm text-[var(--color-text-secondary)]">
            {t(
              selectionLocked
                ? isGenerative
                  ? 'media:proposals.narrativeLockedHint'
                  : 'media:proposals.lockedHint'
                : isGenerative
                  ? 'media:proposals.narrativeHint'
                  : 'media:proposals.hint',
            )}
          </p>

          {isGenerative && null}

          {isLoading && (
            <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
              {t('common:loading')}
            </div>
          )}

          {isError && (
            <EmptyState
              title={t('common:error.loadFailed')}
              description={error instanceof ApiError ? error.message : undefined}
              className="py-8"
            >
              <button type="button" className="btn-secondary mt-3" onClick={() => void refetch()}>
                {t('common:retry')}
              </button>
            </EmptyState>
          )}

          {!isLoading && !isError && aiProposals.length === 0 && (
            <EmptyState
              icon={<IconSparkles size={36} stroke={1.25} />}
              title={t('media:proposals.emptyTitle')}
              description={t(
                isGenerative
                  ? 'media:proposals.narrativeEmptyDesc'
                  : 'media:proposals.emptyDesc',
              )}
              className="py-10"
            />
          )}

          {/* Generative single-plan: read-only committed plan, pipeline continues automatically */}
          {!isLoading && !isError && aiProposals.length > 0 && isGenerative && isSinglePlan && (
            <div className="space-y-3" data-testid="narrative-plan-review-container">
              {(() => {
                const primaryProposal = aiProposals[0]
                const ranges = normalizeCutRanges(primaryProposal.cut_ranges)
                const warnings = normalizeWarnings(primaryProposal.warnings)

                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {primaryProposal.planBody?.title || t('media:proposals.planKindNarrative')}
                        </span>
                        {primaryProposal.planBody?.title && (
                          <span className="media-plan-kind-chip">
                            {t('media:proposals.planKindNarrative')}
                          </span>
                        )}
                        {primaryProposal.confidence != null && (
                          <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
                            {t('media:proposals.confidence', {
                              value: (Number(primaryProposal.confidence) * 100).toFixed(0),
                            })}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className="media-proposal-state-pill"
                          data-testid="narrative-single-plan-badge"
                        >
                          <span>{t('media:proposals.singlePlanCommitted')}</span>
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-sm">
                      {primaryProposal.planBody ? (
                        <NarrativePlanViewer
                          plan={primaryProposal.planBody}
                          cutRanges={ranges}
                          totalDurationMs={primaryProposal.total_duration_ms}
                          sourceSegments={linkedJob?.segments}
                        />
                      ) : (
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {primaryProposal.reasoning_note || '—'}
                        </p>
                      )}
                    </div>

                    {warnings.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {warnings.map((w, i) => (
                          <span key={i} className="media-proposal-warning">
                            {warningLabel(w.code, w.message, t)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Legacy NARRATIVE_REVIEW generative: completed-but-unselected jobs keep the old select path */}
          {!isLoading && !isError && aiProposals.length > 0 && isGenerative && isLegacyGenerative && (
            <div className="space-y-3" data-testid="narrative-legacy-review-container">
              {(() => {
                const primaryProposal = aiProposals[0]
                const ranges = normalizeCutRanges(primaryProposal.cut_ranges)
                const warnings = normalizeWarnings(primaryProposal.warnings)
                const unselected = !job.selectedProposalId

                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {primaryProposal.planBody?.title || t('media:proposals.planKindNarrative')}
                        </span>
                        {primaryProposal.planBody?.title && (
                          <span className="media-plan-kind-chip">
                            {t('media:proposals.planKindNarrative')}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {canEdit && unselected && (
                          <button
                            type="button"
                            className="btn-primary btn-sm inline-flex items-center gap-1.5"
                            data-testid="narrative-legacy-select-btn"
                            onClick={() => void handleSelect(primaryProposal.id)}
                            disabled={selectProposal.isPending}
                          >
                            <IconCheck size={14} />
                            <span>{t('media:proposals.selectPlan')}</span>
                          </button>
                        )}
                        {!unselected && (
                          <span
                            className="media-proposal-state-pill locked"
                            data-testid="narrative-legacy-locked-badge"
                          >
                            <IconLock size={12} />
                            <span>{t('media:proposals.locked')}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-sm">
                      {primaryProposal.planBody ? (
                        <NarrativePlanViewer
                          plan={primaryProposal.planBody}
                          cutRanges={ranges}
                          totalDurationMs={primaryProposal.total_duration_ms}
                          sourceSegments={linkedJob?.segments}
                        />
                      ) : (
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {primaryProposal.reasoning_note || '—'}
                        </p>
                      )}
                    </div>

                    {warnings.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {warnings.map((w, i) => (
                          <span key={i} className="media-proposal-warning">
                            {warningLabel(w.code, w.message, t)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Extractive cut proposal grid */}
          {!isLoading && !isError && !isGenerative && (aiProposals.length > 0 || (canEdit && isExtractive && !selectionLocked)) && (
            <div className="media-proposal-grid">
              {aiProposals.map((p, idx) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  job={job}
                  rank={idx + 1}
                  selectionState={resolveSelectionState(p.id)}
                  selectionLocked={selectionLocked}
                  requestedSec={job.requestedDurationSeconds}
                  onSelect={() => void handleSelect(p.id)}
                  busy={selectProposal.isPending}
                  canSelect={canEdit}
                  sourceSegments={linkedJob?.segments}
                />
              ))}

              {/* Custom cut option — extractive only (runtime has no narrative body editor). */}
              {canEdit && isExtractive && !selectionLocked && (
                <button
                  type="button"
                  className={cn(
                    'media-proposal-card media-proposal-card-custom-entry text-left',
                    showCustomForm && 'expanded',
                    humanProposals.some((p) => p.id === activeSelectedId) && 'selected',
                  )}
                  disabled={createCustom.isPending}
                  onClick={() => setShowCustomForm((v) => !v)}
                >
                  <div className="media-proposal-meta">
                    <span className="media-proposal-rank media-proposal-rank-custom">
                      <IconPlus size={14} />
                    </span>
                    <span className="text-sm font-semibold">{t('media:proposals.custom')}</span>
                    {humanProposals.some((p) => p.id === activeSelectedId) && (
                      <span className="media-proposal-selected-mark ml-auto">
                        <IconCheck size={12} stroke={2.5} />
                        {t('media:proposals.selected')}
                      </span>
                    )}
                  </div>
                  <p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {showCustomForm
                      ? t('media:proposals.customFormOpen')
                      : t('media:proposals.customEntryHint')}
                  </p>
                </button>
              )}
            </div>
          )}

          {showCustomForm && canEdit && isExtractive && !selectionLocked && (
            <div className="media-custom-form mt-3">
              <div className="media-custom-form-title">
                <IconUserEdit size={15} />
                {t('media:proposals.createCustom')}
              </div>
              <div className="media-config-grid cols-2">
                <div className="media-config-block">
                  <label className="field-label">
                    <span>{t('media:trim.startSec')}</span>
                    <input
                      className="field-input"
                      type="number"
                      min={0}
                      step={0.1}
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </label>
                </div>
                <div className="media-config-block">
                  <label className="field-label">
                    <span>{t('media:trim.endSec')}</span>
                    <input
                      className="field-input"
                      type="number"
                      min={0}
                      step={0.1}
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="media-config-block mt-3">
                <label className="field-label">
                  <span>{t('media:proposals.note')}</span>
                  <textarea
                    className="field-input min-h-[72px]"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('media:proposals.notePlaceholder')}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={createCustom.isPending}
                  onClick={() => void handleCreateCustom()}
                >
                  <IconPlus size={16} />
                  {createCustom.isPending
                    ? t('common:loading')
                    : t('media:proposals.createCustom')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCustomForm(false)}
                >
                  {t('common:actions.cancel')}
                </button>
              </div>
            </div>
          )}

          {isExtractive && humanProposals.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                {t('media:proposals.customList')}
              </div>
              <div className="media-proposal-grid media-proposal-grid-2">
                {humanProposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    job={job}
                    selectionState={resolveSelectionState(p.id)}
                    selectionLocked={selectionLocked}
                    requestedSec={job.requestedDurationSeconds}
                    onSelect={() => void handleSelect(p.id)}
                    busy={selectProposal.isPending}
                    canSelect={canEdit}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {formError && <p className="mb-0 text-sm text-[var(--color-error)]">{formError}</p>}
    </div>
  )
}

function warningLabel(
  code: string | undefined,
  message: string | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const normalized = (code || '')
    .toUpperCase()
    .replace(/-/g, '_')
  if (
    normalized === 'SHORTER_THAN_REQUESTED' ||
    normalized === 'SHORTER_THAN_REQUEST'
  ) {
    return t('proposals.warnings.SHORTER_THAN_REQUESTED')
  }
  if (
    normalized === 'LONGER_THAN_REQUESTED' ||
    normalized === 'LONGER_THAN_REQUEST'
  ) {
    return t('proposals.warnings.LONGER_THAN_REQUESTED')
  }
  if (normalized === 'OUTSIDE_TOLERANCE') {
    return t('proposals.warnings.OUTSIDE_TOLERANCE')
  }
  if (message && !/^[A-Z0-9_]+$/.test(message)) return message
  if (code) return t('proposals.warnings.generic', { code })
  return message || t('proposals.warnings.generic', { code: 'WARN' })
}

function SelectionStateMark({ state }: { state: ProposalSelectionUiState }) {
  const { t } = useTranslation('media')
  if (state === 'candidate') return null
  if (state === 'activating') {
    return (
      <span className="media-proposal-selected-mark media-proposal-state-activating ml-auto">
        <IconLoader2 size={12} stroke={2.5} className="animate-spin" />
        {t('proposals.activating')}
      </span>
    )
  }
  if (state === 'activated') {
    return (
      <span className="media-proposal-selected-mark media-proposal-state-activated ml-auto">
        <IconPlayerPlay size={12} stroke={2.5} />
        {t('proposals.activated')}
        <IconLock size={11} stroke={2.5} />
        {t('proposals.locked')}
      </span>
    )
  }
  // 'selected'
  return (
    <span className="media-proposal-selected-mark ml-auto">
      <IconCheck size={12} stroke={2.5} />
      {t('proposals.selected')}
    </span>
  )
}

export function ProposalCard({
  proposal,
  job,
  selectionState,
  selectionLocked,
  requestedSec,
  onSelect,
  busy,
  canSelect,
  rank,
  sourceSegments,
}: {
  proposal: MediaSummaryProposal
  job?: Pick<MediaJob, 'recipeId' | 'processingMode' | 'selectedProposalId'>
  selectionState: ProposalSelectionUiState
  selectionLocked: boolean
  requestedSec: number | null
  onSelect: () => void
  busy: boolean
  canSelect: boolean
  rank?: number
  sourceSegments?: SourceDialogueSegment[]
}) {
  const { t } = useTranslation('media')
  const ranges = normalizeCutRanges(proposal.cut_ranges)
  const warnings = normalizeWarnings(proposal.warnings)
  const totalMs = proposal.total_duration_ms
  const delta =
    requestedSec != null ? Math.round(totalMs / 1000) - requestedSec : null
  const isHuman = String(proposal.generated_by).toUpperCase() === 'HUMAN'
  const narrative = isNarrativeProposal(proposal)
  const planKind = resolveProposalPlanKind(proposal, job)
  const planStatus = resolvePlanStatus(proposal, job?.selectedProposalId)
  const isSelectedCard = selectionState !== 'candidate'
  // Selected card stays non-clickable; others disabled once any selection is locked.
  const interactive = canSelect && !busy && !selectionLocked && !isSelectedCard

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onSelect}
      aria-pressed={isSelectedCard}
      data-plan-kind={planKind ?? undefined}
      data-plan-status={planStatus}
      data-selection-state={selectionState}
      className={cn(
        'media-proposal-card text-left',
        isSelectedCard && 'selected',
        selectionState === 'activated' && 'activated',
        selectionLocked && !isSelectedCard && 'locked-out',
        isHuman && 'custom',
        narrative && 'narrative',
      )}
    >
      <div className="media-proposal-meta">
        {rank != null && <span className="media-proposal-rank">{rank}</span>}
        {isHuman && rank == null && (
          <span className="media-proposal-rank media-proposal-rank-custom">
            <IconUserEdit size={12} />
          </span>
        )}
        <span className="text-sm font-semibold">
          {proposal.proposal_index != null
            ? t('proposals.aiIndex', { n: proposal.proposal_index })
            : t('proposals.custom')}
        </span>
        {planKind && (
          <span className="media-plan-kind-chip" title={planKind}>
            {planKind === 'NARRATIVE_PLAN'
              ? t('proposals.planKindNarrative')
              : planKind === 'CUT_PLAN'
                ? t('proposals.planKindCut')
                : planKind}
          </span>
        )}
        {proposal.confidence != null && (
          <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
            {t('media:proposals.confidence', {
              value: (Number(proposal.confidence) * 100).toFixed(0),
            })}
          </span>
        )}
        <SelectionStateMark state={selectionState} />
      </div>

      {narrative ? (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <NarrativePlanViewer
            plan={proposal.planBody}
            cutRanges={ranges}
            totalDurationMs={totalMs}
            sourceSegments={sourceSegments}
          />
        </div>
      ) : (
        <>
          <p className="mb-2 mt-0 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {proposal.reasoning_note || '—'}
          </p>
          <div className="media-duration-compare mb-2">
            {requestedSec != null && (
              <span className="requested">
                {t('proposals.requested')}: {requestedSec}s
              </span>
            )}
            <span className="proposed">{formatDurationMs(totalMs)}</span>
            {delta != null && (
              <span className={cn('delta', Math.abs(delta) <= 10 ? 'ok' : 'warn')}>
                {delta >= 0 ? `+${delta}s` : `${delta}s`}
              </span>
            )}
          </div>
          <CutRangesTimeline ranges={ranges} totalMs={totalMs} />
        </>
      )}

      {warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {warnings.map((w, i) => (
            <span key={i} className="media-proposal-warning">
              {warningLabel(w.code, w.message, t)}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

/** Compact cut-range presentation for CUT_PLAN (and denorm coverage). */
function CutRangesTimeline({
  ranges,
  totalMs,
}: {
  ranges: Array<{ startMs: number; endMs: number }>
  totalMs: number
}) {
  const { t } = useTranslation('media')
  if (ranges.length === 0) return null

  const span =
    totalMs > 0
      ? totalMs
      : Math.max(...ranges.map((r) => r.endMs), 1)

  return (
    <div className="media-cut-timeline" data-testid="cut-ranges-timeline">
      <div className="media-cut-timeline-track" aria-hidden>
        {ranges.map((r, i) => {
          const left = Math.max(0, Math.min(100, (r.startMs / span) * 100))
          const width = Math.max(
            1.5,
            Math.min(100 - left, ((r.endMs - r.startMs) / span) * 100),
          )
          return (
            <span
              key={i}
              className="media-cut-timeline-seg"
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {ranges.map((r, i) => (
          <span key={i} className="media-range-chip">
            {formatDurationMs(r.startMs)}–{formatDurationMs(r.endMs)}
          </span>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">
        {t('proposals.cutTimelineHint')}
      </div>
    </div>
  )
}
