import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCheck,
  IconLanguage,
  IconLoader2,
  IconMicrophone2,
  IconMovie,
  IconSparkles,
  IconVolume,
  IconWaveSine,
  IconX,
} from '@tabler/icons-react'
import { StageBadge } from '@/components/media-studio/StageBadge'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { cn } from '@/lib/cn'
import {
  isExtractiveRecipe,
  orderedMediaStages,
  QA_BLOCKED,
  resolveRecipeId,
} from '@/lib/media'
import type { MediaJob, MediaJobStage, RenderFailureReason } from '@/types/media'

const ICONS: Record<string, typeof IconWaveSine> = {
  EXTRACT_AUDIO: IconWaveSine,
  SOURCE_SEPARATION: IconWaveSine,
  STT: IconMicrophone2,
  SUMMARIZE: IconSparkles,
  TRANSLATE: IconLanguage,
  TTS: IconVolume,
  AUDIO_MIX: IconVolume,
  RENDER: IconMovie,
}

type Props = {
  job: MediaJob
  className?: string
}

function stageClass(status: string): string {
  const s = status.toUpperCase()
  if (s === 'COMPLETED') return 'done'
  if (s === 'PROCESSING') return 'active'
  if (s === 'FAILED') return 'error'
  if (s === 'STALE') return 'stale'
  if (s === 'SKIPPED') return 'skipped'
  if (s === 'CANCEL_REQUESTED') return 'cancel-requested'
  if (s === 'CANCELLED') return 'cancelled'
  return ''
}

function DotIcon({ stage }: { stage: MediaJobStage }) {
  const s = String(stage.status).toUpperCase()
  if (s === 'PROCESSING') return <IconLoader2 size={18} className="animate-spin" />
  if (s === 'COMPLETED') return <IconCheck size={18} />
  if (s === 'FAILED') return <IconX size={18} />
  if (s === 'STALE') return <IconAlertTriangle size={18} />
  const Icon = ICONS[stage.stageName] ?? IconMovie
  return <Icon size={18} />
}

/**
 * W3 structured recovery guidance key (docs/19 §1.8.2 · docs/17 Q-M-WORKFLOW-07):
 * derived ONLY from the backend failureReason — never from errorMessage text.
 * Returns null for every other failure (unrelated RENDER FAILED keeps its UX).
 */
function renderRecoveryKey(stage: MediaJobStage): string | null {
  const s = String(stage.status).toUpperCase()
  if (s !== 'FAILED' || stage.stageName !== 'RENDER') return null
  const reason = stage.failureReason as RenderFailureReason | null | undefined
  if (reason === 'EMPTY_CUES') return 'pipeline.recovery.emptyCues'
  if (reason === 'DURATION_MISMATCH') {
    if (stage.failureDiagnostics?.durationMismatchKind === 'GENERATIVE_TTS_TARGET') {
      return 'pipeline.recovery.generativeTtsDurationMismatch'
    }
    return 'pipeline.recovery.durationMismatch'
  }
  return null
}

const PROVIDER_ERROR_KEYS: Record<string, string> = {
  PROVIDER_QUOTA_EXCEEDED: 'pipeline.providerErrors.quotaExceeded',
  PROVIDER_AUTH_FAILED: 'pipeline.providerErrors.authFailed',
  PROVIDER_PERMISSION_DENIED: 'pipeline.providerErrors.permissionDenied',
  PROVIDER_RATE_LIMITED: 'pipeline.providerErrors.rateLimited',
  PROVIDER_TIMEOUT: 'pipeline.providerErrors.timeout',
  PROVIDER_UNAVAILABLE: 'pipeline.providerErrors.unavailable',
  PROVIDER_MODEL_NOT_FOUND: 'pipeline.providerErrors.modelNotFound',
  PROVIDER_UNSUPPORTED_MODEL: 'pipeline.providerErrors.unsupportedModel',
  PROVIDER_BAD_REQUEST: 'pipeline.providerErrors.badRequest',
  PROVIDER_RESPONSE_MALFORMED: 'pipeline.providerErrors.responseMalformed',
}

/**
 * Retry budget per stage — mirrors backend `MediaStageStuckMonitor.maxRetriesFor`
 * (EXTRACT_AUDIO/STT/SUMMARIZE/TTS/AUDIO_MIX/SOURCE_SEPARATION → 3,
 * TRANSLATE → 1, RENDER → 2). The attempt badge shows `attemptCount/max` so a
 * first STT retry reads `1/3` instead of a hardcoded `3` for every stage.
 */
function maxRetriesForStage(stageName: string): number {
  const s = stageName.toUpperCase()
  if (s === 'RENDER') return 2
  if (s === 'TRANSLATE') return 1
  return 3
}

/**
 * Outgoing connector path class — COMPLETED paints a green completed-path.
 * SKIPPED only paints green once the workflow has actually reached the stage
 * (a later stage started): stages pre-marked SKIPPED at creation (e.g.
 * SOURCE_SEPARATION / SUMMARIZE on some recipes) stay neutral until the
 * pipeline passes them. SKIPPED node styling itself stays distinct (stageClass).
 */
function connectorPathClass(status: string, reached: boolean): string {
  const s = status.toUpperCase()
  if (s === 'COMPLETED') return 'connector-done'
  if (s === 'SKIPPED') return reached ? 'connector-done' : 'connector-pending'
  if (s === 'FAILED') return 'connector-error'
  // PROCESSING / CANCEL_REQUESTED / PENDING: the outgoing line stays neutral
  // (gray) until the stage completes — the node itself shows the in-flight state.
  return 'connector-pending'
}

/** Linear pipeline stepper — dynamic stage list from API (CT6.1: 6 or 8 stages). */
export function PipelineStepper({ job, className }: Props) {
  const { t } = useTranslation('media')
  /** Dubbed intent: voice chosen ⇒ TTS must run (Q-M-D5). SKIPPED here = state inconsistency. */
  const hasSelectedVoice = (job.voiceId ?? '').trim().length > 0
  const translateScopeKey = isExtractiveRecipe(job)
    ? 'pipeline.translateScopeCutPlan'
    : resolveRecipeId(job) === 'localization.full'
      ? 'pipeline.translateScopeFullVideo'
      : null

  const stages: MediaJobStage[] = orderedMediaStages(job)

  // Fail-closed: stage status is API-owned. Never render placeholder stages with
  // invented PENDING/SKIPPED status — show a neutral no-data state instead.
  if (stages.length === 0) {
    return (
      <div
        className={cn('media-pipeline-stepper', className)}
        data-testid="pipeline-no-stages"
      >
        <p className="media-stage-meta">{t('pipeline.noStages')}</p>
      </div>
    )
  }

  return (
    <div className={cn('media-pipeline-stepper', className)} data-testid="pipeline-stepper">
      {stages.map((stage, idx) => {
        const st = String(stage.status).toUpperCase()
        const attempts = stage.attemptCount ?? 0
        // Unified status vocabulary: every stage shows progress while in-flight.
        // Never invent PROCESSING — only render when the API status is already that.
        const showProgress = st === 'PROCESSING' || st === 'CANCEL_REQUESTED'
        // A SKIPPED stage's connector only turns green once the workflow passed
        // it — i.e. some later runnable stage has actually started (left
        // PENDING). STALE does NOT count: STALE marks a rewind (STT reset +
        // downstream invalidated), so pre-marked SKIPPED stages must not show a
        // green path the workflow has not genuinely reached again.
        const reached = stages
          .slice(idx + 1)
          .some((s) => {
            const later = String(s.status).toUpperCase()
            return (
              later === 'PROCESSING' ||
              later === 'COMPLETED' ||
              later === 'FAILED' ||
              later === 'CANCELLED' ||
              later === 'CANCEL_REQUESTED'
            )
          })
        const connectorClass = connectorPathClass(st, reached)
        const waitingForQa = st === 'PENDING' && stage.errorCode === QA_BLOCKED

        return (
          <div
            key={stage.id}
            className={cn('media-pipeline-stage', stageClass(st), connectorClass)}
            data-stage={stage.stageName}
            data-status={st}
            data-connector={connectorClass}
          >
            <div className="media-stage-dot-circle">
              <DotIcon stage={stage} />
            </div>
            <div className="media-stage-label">
              {t(`stages.${stage.stageName}`, {
                defaultValue: String(stage.stageName).replaceAll('_', ' '),
              })}
            </div>
            {waitingForQa ? (
              <StageBadge
                status={stage.status}
                className="media-stage-waiting-qa"
                label={t('pipeline.waitingForQa')}
              />
            ) : (
              <StageBadge status={stage.status} />
            )}
            {waitingForQa && (
              <div className="media-stage-reason warn" data-testid="stage-waiting-qa">
                <IconAlertTriangle size={10} /> {t('pipeline.waitingForQaReason')}
              </div>
            )}
            {stage.stageName === 'TRANSLATE' && translateScopeKey && (
              <div className="media-stage-meta">{t(translateScopeKey)}</div>
            )}
            {/* A retry count on a finished stage only alarms users — show it while
                the stage is still being retried or after it failed. */}
            {attempts >= 1 && (st === 'PROCESSING' || st === 'PENDING' || st === 'FAILED') && (
              <div
                className="media-stage-meta"
                data-testid={`stage-attempt-${stage.stageName}`}
              >
                {t('pipeline.attempt', {
                  current: attempts,
                  max: maxRetriesForStage(stage.stageName),
                })}
              </div>
            )}
            {st === 'PENDING' &&
              stage.errorMessage?.startsWith('Attempt') && (
                <div className="media-stage-reason warn">
                  <IconAlertTriangle size={10} />{' '}
                  {t(stage.errorMessage, {
                    defaultValue: stage.errorMessage,
                  })}
                </div>
              )}
            {st === 'STALE' && stage.errorMessage && (
              <div className="media-stage-reason">
                <IconAlertTriangle size={10} /> {t(stage.errorMessage, { defaultValue: stage.errorMessage })}
              </div>
            )}
            {st === 'FAILED' && (stage.errorCode || stage.errorMessage || stage.errorDetail) && (
              <div className="media-stage-reason error">
                {(() => {
                  const key = stage.errorCode ? PROVIDER_ERROR_KEYS[stage.errorCode] : null
                  if (!key) return stage.errorDetail?.message || stage.errorMessage
                  const stageLabel = t(`stages.${stage.stageName}`, {
                    defaultValue: String(stage.stageName).replaceAll('_', ' '),
                  })
                  return t(key, { stage: stageLabel })
                })()}
              </div>
            )}
            {(() => {
              const recoveryKey = renderRecoveryKey(stage)
              if (!recoveryKey) return null
              return (
                <div className="media-stage-reason error">
                  <IconAlertTriangle size={10} /> {t(recoveryKey)}
                </div>
              )
            })()}
            {showProgress && (
              <div className="media-stage-progress-wrap" data-testid={`stage-progress-${stage.stageName}`}>
                <ProgressBar value={stage.progressPercent ?? 0} className="h-1" />
                <span className="media-stage-meta tabular">
                  {Math.min(100, Math.max(0, stage.progressPercent ?? 0))}%
                </span>
              </div>
            )}
            {st === 'SKIPPED' && stage.stageName === 'SUMMARIZE' && (
              <div className="media-stage-meta">{t('pipeline.skippedSummarize')}</div>
            )}
            {st === 'SKIPPED' &&
              (stage.stageName === 'SOURCE_SEPARATION' || stage.stageName === 'AUDIO_MIX') && (
              <div className="media-stage-meta">{t('pipeline.skippedAudioOptional')}</div>
            )}
            {st === 'SKIPPED' &&
              stage.stageName === 'TTS' &&
              (hasSelectedVoice ? (
                <div className="media-stage-reason warn">
                  <IconAlertTriangle size={10} /> {t('pipeline.ttsSkippedWithVoiceSelected')}
                </div>
              ) : (
                <div className="media-stage-meta">{t('pipeline.skippedTtsOriginal')}</div>
              ))}
            {idx < stages.length - 1 && (
              <span
                className={cn('media-pipeline-connector', connectorClass)}
                data-connector={connectorClass}
                aria-hidden
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
