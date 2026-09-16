import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconLoader2,
  IconRefresh,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/shared/Modal'
import { useCreateJob } from '@/hooks/useJobs'
import { useSSE } from '@/hooks/useSSE'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'
import { buildWorkspacePath } from '@/lib/api/client'
import { queryKeys } from '@/lib/queryClient'
import { isActiveBatchStatus } from '@/lib/status'
import { useEditorStore } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { CreateJobBody, JobStreamEvent, JobSummary } from '@/types/job'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  documentId: string
  existingJobs: JobSummary[]
  defaultTargetLang?: string
  onCreated?: (jobId: string) => void
}

/** C.6 Create translation job for one target language. */
export function CreateJobModal({
  open,
  onClose,
  workspaceId,
  documentId,
  existingJobs,
  defaultTargetLang = 'vi',
  onCreated,
}: Props) {
  const { t } = useTranslation(['job', 'common'])
  const language = useUiStore((state) => state.language)
  const create = useCreateJob(workspaceId, documentId)
  const queryClient = useQueryClient()
  const [targetLang, setTargetLang] = useState(defaultTargetLang)
  const [error, setError] = useState<string | null>(null)
  const [streamJobId, setStreamJobId] = useState<string | null>(null)
  const [currentSegment, setCurrentSegment] = useState<number | null>(null)
  const [completedSegments, setCompletedSegments] = useState(0)
  const completedSeqsRef = useRef(new Set<number>())
  const streamJobIdRef = useRef<string | null>(null)
  const doneHandledRef = useRef(false)
  const streamingTokens = useEditorStore((s) => s.streamingTokens)
  const pipelineStage = useEditorStore((s) => s.pipelineStage)
  const setPipelineStage = useEditorStore((s) => s.setPipelineStage)
  const setStreamingTokens = useEditorStore((s) => s.setStreamingTokens)
  const appendStreamingTokens = useEditorStore((s) => s.appendStreamingTokens)

  const { start, cancel, status: streamStatus, reconnectAttempt } = useSSE<JobStreamEvent>({
    onEvent: ({ event, data }) => {
      if (data.jobId) {
        streamJobIdRef.current = data.jobId
        setStreamJobId(data.jobId)
      }

      if (event === 'job') {
        setPipelineStage(data.status === 'PROCESSING' ? 'translating' : 'queued')
      } else if (event === 'segment') {
        if (data.seq != null) setCurrentSegment(data.seq)
        if (data.stage === 'STARTED') setPipelineStage('tm')
        if (data.stage === 'COMPLETED' && data.seq != null) {
          completedSeqsRef.current.add(data.seq)
          setCompletedSegments(completedSeqsRef.current.size)
        }
      } else if (event === 'stage') {
        setPipelineStage(mapStreamStage(data.stage))
      } else if (event === 'token' && data.delta) {
        appendStreamingTokens(data.delta)
      } else if (event === 'done' && data.detail) {
        // Idempotent: resume may re-deliver a terminal `done` after reconnect.
        if (doneHandledRef.current) return
        doneHandledRef.current = true
        const job = data.detail
        setPipelineStage('awaitingReview')
        queryClient.setQueryData(queryKeys.job(workspaceId, job.id), job)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.jobs(workspaceId, documentId),
        })
        void queryClient.invalidateQueries({ queryKey: ['usage', workspaceId] })
        cancel()
        resetStreamState()
        onClose()
        onCreated?.(job.id)
      }
    },
  })

  const activeLangs = useMemo(
    () =>
      new Set(
        existingJobs
          .filter((j) => isActiveBatchStatus(j.status))
          .map((j) => j.targetLang.toLowerCase()),
      ),
    [existingJobs],
  )

  const handleClose = () => {
    if (isBusy) return
    cancel()
    setError(null)
    resetStreamState()
    onClose()
  }

  const resetStreamState = () => {
    streamJobIdRef.current = null
    doneHandledRef.current = false
    completedSeqsRef.current = new Set()
    setStreamJobId(null)
    setCurrentSegment(null)
    setCompletedSegments(0)
    setPipelineStage(null)
    setStreamingTokens('')
  }

  const finishSyncFallback = (body: CreateJobBody) => {
    create.mutate(body, {
      onSuccess: (job) => {
        setError(null)
        resetStreamState()
        onClose()
        onCreated?.(job.id)
      },
      onError: (err) => {
        setError(err instanceof ApiError ? err.message : t('common:error.generic'))
      },
    })
  }

  const openInterruptedJob = () => {
    if (!streamJobId) return
    const jobId = streamJobId
    cancel()
    resetStreamState()
    onClose()
    onCreated?.(jobId)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const lang = targetLang.trim().toLowerCase()
    if (!lang) {
      setError(t('job:create.langRequired'))
      return
    }
    if (activeLangs.has(lang)) {
      setError(t('job:create.duplicateActive'))
      return
    }

    const body = { targetLang: lang }
    resetStreamState()
    try {
      await start(
        buildWorkspacePath(workspaceId, `/documents/${documentId}/jobs/stream`),
        {
          method: 'POST',
          body,
          // Never re-POST create (would spawn a second job). On disconnect after
          // the first `job` event, resume via GET + Last-Event-ID (A.5.5).
          maxReconnectAttempts: 0,
          resumeFrom: () => {
            const jobId = streamJobIdRef.current
            if (!jobId) return null
            return {
              path: buildWorkspacePath(workspaceId, `/jobs/${jobId}/stream`),
              options: { method: 'GET' },
            }
          },
        },
      )
    } catch (err) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.jobs(workspaceId, documentId),
      })
      const canFallback =
        !streamJobIdRef.current &&
        err instanceof ApiError &&
        (err.status === 404 || err.status === 405 || err.status === 501)
      if (canFallback) {
        finishSyncFallback(body)
        return
      }
      setError(
        streamJobIdRef.current
          ? t('job:create.streamInterrupted')
          : err instanceof ApiError
            ? err.message
            : t('job:create.streamFailed'),
      )
    }
  }

  const isBusy =
    create.isPending ||
    streamStatus === 'connecting' ||
    streamStatus === 'open' ||
    streamStatus === 'reconnecting'
  const hasStreamProgress = streamStatus !== 'idle'
  const preview = streamingTokens.slice(-900)

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('job:create.title')}
      description={t('job:create.subtitle')}
      size={hasStreamProgress ? 'lg' : 'md'}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            disabled={isBusy}
            onClick={handleClose}
          >
            {t('common:actions.cancel')}
          </button>
          {streamStatus === 'error' && streamJobId ? (
            <button
              type="button"
              className="btn-primary"
              onClick={openInterruptedJob}
            >
              {t('job:create.openJob')}
            </button>
          ) : (
            <button
              type="submit"
              form="create-job-form"
              className="btn-primary"
              disabled={isBusy}
            >
              {isBusy ? (
              <>
                <IconLoader2 size={16} className="animate-spin" />
                {t('job:create.submitting')}
              </>
              ) : streamStatus === 'error' ? (
                <>
                  <IconRefresh size={16} />
                  {t('common:retry')}
                </>
              ) : (
                t('job:create.submit')
              )}
            </button>
          )}
        </>
      }
    >
      <form id="create-job-form" onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="job-target-lang">
            {t('job:create.targetLang')}
          </label>
          <select
            id="job-target-lang"
            className="field-input"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            disabled={isBusy}
          >
            {LANG_OPTIONS.map((code) => (
              <option key={code} value={code} disabled={activeLangs.has(code)}>
                {formatLanguageOption(code, language)}
                {activeLangs.has(code) ? ` (${t('job:create.active')})` : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[12px] text-[var(--color-text-tertiary)]">{t('job:create.hint')}</p>
        {hasStreamProgress && (
          <div className="job-stream-panel" aria-live="polite">
            <div className="job-stream-status">
              <span className={`job-stream-indicator ${streamStatus}`}>
                {streamStatus === 'reconnecting' || streamStatus === 'error' ? (
                  <IconWifiOff size={15} />
                ) : streamStatus === 'open' ? (
                  <IconWifi size={15} />
                ) : (
                  <IconLoader2 size={15} className={isBusy ? 'animate-spin' : ''} />
                )}
                {t(`job:create.streamStatus.${streamStatus}`, {
                  attempt: reconnectAttempt,
                })}
              </span>
              {streamJobId && (
                <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
                  {streamJobId.slice(0, 8)}
                </span>
              )}
            </div>

            <div className="job-stream-meta">
              <span>{t('job:create.pipelineStage')}</span>
              <strong>{t(`job:pipeline.${pipelineStage || 'queued'}`)}</strong>
              <span>{t('job:create.completedSegments')}</span>
              <strong>{completedSegments}</strong>
              {currentSegment != null && (
                <>
                  <span>{t('job:create.currentSegment')}</span>
                  <strong>#{currentSegment}</strong>
                </>
              )}
            </div>

            <div className="job-stream-preview">
              <div className="job-stream-preview-label">
                {t('job:create.liveOutput')}
              </div>
              {preview ? (
                <p>
                  {preview}
                  {streamStatus === 'open' && <span className="streaming-cursor" />}
                </p>
              ) : (
                <p className="text-[var(--color-text-tertiary)]">
                  {t('job:create.waitingTokens')}
                </p>
              )}
            </div>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  )
}

function mapStreamStage(stage: string): string {
  if (stage === 'TM_LOOKUP' || stage === 'TM_EXACT') return 'tm'
  if (stage === 'TRANSLATING') return 'translating'
  if (stage === 'QA_CHECKING') return 'qa'
  if (stage === 'TM_WRITE_BACK') return 'awaitingReview'
  return 'queued'
}
