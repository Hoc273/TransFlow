import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconDeviceDesktop,
  IconQuestionMark,
  IconSparkles,
} from '@tabler/icons-react'
import { HistoryPanel } from '@/components/editor/HistoryPanel'
import { SegmentList } from '@/components/editor/SegmentList'
import { QaIssuePanel } from '@/components/qa/QaIssuePanel'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  useApproveSegment,
  useJob,
  useOverrideQaIssue,
  useResolveQaIssue,
  useUpdateSegment,
} from '@/hooks/useJobs'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { usePermission } from '@/hooks/usePermission'
import { formatRelativeTime } from '@/lib/format'
import { isApprovalBlocked, openIssues } from '@/lib/qa'
import { asJobStatus } from '@/lib/status'
import { useAuthStore } from '@/store/authStore'
import { useEditorStore } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'
import type { SegmentItem } from '@/types/job'
import type { SegmentStatus } from '@/types/job'

type SideTab = 'qa' | 'history' | 'version' | 'comment'
type SegFilter = 'ALL' | SegmentStatus | 'HAS_QA'

const AUTOSAVE_MS = 1500

/** Phase E — Translation Editor (core). */
export function EditorPage() {
  const { t } = useTranslation(['job', 'common', 'dashboard'])
  const { workspaceId = '', jobId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)

  const canEdit = usePermission('segment.edit')
  const canApprove = usePermission('segment.approve')
  const canApplyQa = usePermission('qa.apply')
  const canResolve = usePermission('qa.resolve')
  const canOverride = usePermission('qa.override')
  const canStartJob = usePermission('job.start')

  const { data: job, isLoading, isError, error, refetch } = useJob(workspaceId, jobId)
  const updateSeg = useUpdateSegment(workspaceId, jobId)
  const approveSeg = useApproveSegment(workspaceId, jobId)
  const resolveIssue = useResolveQaIssue(workspaceId, jobId)
  const overrideIssue = useOverrideQaIssue(workspaceId, jobId)

  const {
    activeSegmentId,
    setActiveSegmentId,
    draftTargets,
    setDraftTarget,
    clearDraft,
    unsavedSegmentIds,
    markUnsaved,
    markSaving,
    markSaved,
    markSaveFailed,
    lastSavedAt,
    savingSegmentIds,
    editing,
    setEditing,
    reset,
  } = useEditorStore()

  const [sideTab, setSideTab] = useState<SideTab>('qa')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SegFilter>('ALL')
  const [helpOpen, setHelpOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<HTMLTextAreaElement>(null)
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saveChains = useRef<Map<string, Promise<void>>>(new Map())

  useDocumentTitle(
    job ? `${job.targetLang.toUpperCase()} · Editor` : t('job:editor.title'),
  )

  useEffect(() => {
    reset()
    return () => {
      saveTimers.current.forEach((tm) => clearTimeout(tm))
      saveTimers.current.clear()
      reset()
    }
  }, [jobId, reset])

  const segments = job?.segments ?? []

  useEffect(() => {
    if (!activeSegmentId && segments[0]) {
      setActiveSegmentId(segments[0].id)
    }
  }, [segments, activeSegmentId, setActiveSegmentId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return segments.filter((s) => {
      if (statusFilter === 'HAS_QA') {
        if (!openIssues(s.qaIssues).length) return false
      } else if (statusFilter !== 'ALL' && s.status !== statusFilter) {
        return false
      }
      if (!q) return true
      const target = (draftTargets[s.id] ?? s.targetText ?? '').toLowerCase()
      return (
        s.sourceText.toLowerCase().includes(q) ||
        target.includes(q) ||
        String(s.seq).includes(q)
      )
    })
  }, [segments, search, statusFilter, draftTargets])

  const active = useMemo(
    () => segments.find((s) => s.id === activeSegmentId) ?? null,
    [segments, activeSegmentId],
  )

  const targetValue =
    active != null
      ? (draftTargets[active.id] ?? active.targetText ?? '')
      : ''

  const flushSave = useCallback(
    async (segmentId: string) => {
      const timer = saveTimers.current.get(segmentId)
      if (timer) {
        clearTimeout(timer)
        saveTimers.current.delete(segmentId)
      }
      const text = useEditorStore.getState().draftTargets[segmentId]
      if (text === undefined) return
      const server = segments.find((s) => s.id === segmentId)?.targetText ?? ''
      if (text === (server ?? '')) {
        markSaved(segmentId)
        return
      }

      const prev = saveChains.current.get(segmentId) ?? Promise.resolve()
      const next = prev
        .catch(() => undefined)
        .then(async () => {
          markSaving(segmentId)
          try {
            await updateSeg.mutateAsync({
              segmentId,
              body: { targetText: text },
            })
            markSaved(segmentId)
          } catch {
            markSaveFailed(segmentId)
          }
        })
      saveChains.current.set(segmentId, next)
      await next
    },
    [segments, updateSeg, markSaved, markSaving, markSaveFailed],
  )

  const scheduleSave = useCallback(
    (segmentId: string) => {
      const existing = saveTimers.current.get(segmentId)
      if (existing) clearTimeout(existing)
      markUnsaved(segmentId)
      const tm = setTimeout(() => {
        void flushSave(segmentId)
      }, AUTOSAVE_MS)
      saveTimers.current.set(segmentId, tm)
    },
    [flushSave, markUnsaved],
  )

  const selectSegment = useCallback(
    async (id: string) => {
      const prev = useEditorStore.getState().activeSegmentId
      if (prev && prev !== id && useEditorStore.getState().unsavedSegmentIds.has(prev)) {
        await flushSave(prev)
      }
      setActiveSegmentId(id)
      setEditing(false)
      setActionError(null)
    },
    [flushSave, setActiveSegmentId, setEditing],
  )

  const moveActive = useCallback(
    (delta: number) => {
      if (!filtered.length) return
      const idx = filtered.findIndex((s) => s.id === activeSegmentId)
      const next = filtered[Math.max(0, Math.min(filtered.length - 1, (idx < 0 ? 0 : idx) + delta))]
      if (next) void selectSegment(next.id)
    },
    [filtered, activeSegmentId, selectSegment],
  )

  const onTargetChange = (value: string) => {
    if (!active || !canEdit) return
    setDraftTarget(active.id, value)
    scheduleSave(active.id)
  }

  const handleApprove = useCallback(async () => {
    if (!active || !canApprove) return
    if (isApprovalBlocked(active.qaIssues)) {
      setActionError(t('job:editor.approveBlocked'))
      return
    }
    setActionError(null)
    if (unsavedSegmentIds.has(active.id)) {
      await flushSave(active.id)
    }
    try {
      await approveSeg.mutateAsync(active.id)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('common:error.generic'))
    }
  }, [active, canApprove, unsavedSegmentIds, flushSave, approveSeg, t])

  const handleResolve = useCallback(
    (issueId: string, applySuggestion: boolean) => {
      if (!canResolve && !(applySuggestion && canApplyQa)) return
      resolveIssue.mutate(
        { issueId, body: { applySuggestion } },
        {
          onError: (err) => {
            setActionError(err instanceof ApiError ? err.message : t('common:error.generic'))
          },
        },
      )
    },
    [canResolve, canApplyQa, resolveIssue, t],
  )

  const handleOverride = useCallback(
    (issueId: string, body: { blockingAction: string; reason: string }) => {
      overrideIssue.mutate(
        { issueId, body },
        {
          onError: (err) => {
            setActionError(err instanceof ApiError ? err.message : t('common:error.generic'))
          },
        },
      )
    },
    [overrideIssue, t],
  )

  const handleApplyFirstQa = useCallback(() => {
    if (!active || !canApplyQa) return
    const first = openIssues(active.qaIssues).find((i) => i.suggestion)
    if (first) handleResolve(first.id, true)
  }, [active, canApplyQa, handleResolve])

  useKeyboardShortcuts({
    enabled: true,
    onPrev: () => moveActive(-1),
    onNext: () => moveActive(1),
    onEdit: () => {
      if (!canEdit) return
      setEditing(true)
      requestAnimationFrame(() => targetRef.current?.focus())
    },
    onEscape: () => {
      if (editing && active) {
        const server = active.targetText ?? ''
        const draft = draftTargets[active.id]
        if (draft !== undefined && draft !== server) {
          if (!window.confirm(t('job:editor.discardConfirm'))) return
          clearDraft(active.id)
          markSaved(active.id)
        }
        setEditing(false)
      }
    },
    onSave: () => {
      if (active && canEdit) void flushSave(active.id)
    },
    onApprove: () => {
      void handleApprove()
    },
    onApplyQa: handleApplyFirstQa,
    onSearchFocus: () => searchRef.current?.focus(),
    onHelp: () => setHelpOpen(true),
  })

  // Tab close / reload when unsaved (SPA route guard needs data router — E.4 later).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().unsavedSegmentIds.size > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const saveStatus = (() => {
    if (!active) return null
    if (savingSegmentIds.has(active.id)) return 'saving' as const
    if (unsavedSegmentIds.has(active.id)) return 'unsaved' as const
    if (lastSavedAt[active.id]) return 'saved' as const
    return null
  })()

  const pipelineStage = mapPipeline(job?.status, active)

  if (isLoading) {
    return (
      <div className="app-card py-16 text-center text-sm text-[var(--color-text-tertiary)]">
        {t('common:loading')}
      </div>
    )
  }

  if (isError || !job) {
    return (
      <div className="app-card">
        <EmptyState
          icon={<IconAlertTriangle size={40} stroke={1.25} />}
          title={t('common:error.loadFailed')}
          description={error instanceof ApiError ? error.message : undefined}
          className="py-12"
        >
          <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
            {t('common:retry')}
          </button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="editor-page">
      <div className="editor-mobile-banner md:hidden">
        <IconDeviceDesktop size={18} />
        {t('job:editor.mobileBanner')}
      </div>

      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <Link
          to={`/w/${workspaceId}/documents/${job.documentId}/jobs`}
          className="btn-link"
        >
          {t('job:list.title')}
        </Link>
        <IconChevronRight size={10} />
        <span className="font-mono">{job.targetLang}</span>
      </div>

      <div className="page-header editor-header">
        <div>
          <h1 className="page-title">{t('job:editor.title')}</h1>
          <div className="page-subtitle flex flex-wrap items-center gap-2">
            <StatusBadge status={asJobStatus(job.status)} />
            <span className="font-mono text-[12px]">{job.targetLang}</span>
            {job.modelUsed && (
              <span className="text-[var(--color-text-tertiary)]">{job.modelUsed}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setHelpOpen(true)}
          title="?"
        >
          <IconQuestionMark size={16} />
          {t('job:editor.shortcuts')}
        </button>
      </div>

      <div className="pipeline-stepper" aria-label={t('job:editor.pipeline')}>
        {PIPELINE.map((step) => (
          <div
            key={step}
            className={
              pipelineStage === step
                ? 'pipeline-step active'
                : PIPELINE.indexOf(step) <= PIPELINE.indexOf(pipelineStage)
                  ? 'pipeline-step done'
                  : 'pipeline-step'
            }
          >
            {t(`job:pipeline.${step}`)}
          </div>
        ))}
      </div>

      <div className="editor-toolbar">
        <input
          ref={searchRef}
          className="field-input editor-search"
          placeholder={t('job:editor.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('job:editor.searchPlaceholder')}
        />
        <select
          className="field-input editor-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SegFilter)}
        >
          <option value="ALL">{t('job:editor.filterAll')}</option>
          <option value="NEW">NEW</option>
          <option value="TRANSLATED">TRANSLATED</option>
          <option value="QA_FLAGGED">QA_FLAGGED</option>
          <option value="APPROVED">APPROVED</option>
          <option value="HAS_QA">{t('job:editor.filterHasQa')}</option>
        </select>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">
          {filtered.length}/{segments.length}
        </span>
      </div>

      {actionError && (
        <div className="mb-3 rounded-lg border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error)]">
          {actionError}
        </div>
      )}

      <div className="editor-layout">
        <aside className="editor-col segments-col app-card">
          <div className="editor-col-title">{t('job:editor.segments')}</div>
          {filtered.length === 0 ? (
            <EmptyState
              title={t('job:editor.noMatch')}
              description={t('job:editor.noMatchDesc')}
              className="py-10"
            >
              <button
                type="button"
                className="btn-secondary mt-3"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('ALL')
                }}
              >
                {t('job:editor.clearFilters')}
              </button>
            </EmptyState>
          ) : (
            <SegmentList
              segments={filtered}
              activeId={activeSegmentId}
              unsavedIds={unsavedSegmentIds}
              draftTargets={draftTargets}
              onSelect={(id) => void selectSegment(id)}
            />
          )}
        </aside>

        <section className="editor-col main-col app-card">
          {active ? (
            <>
              <div className="editor-col-title flex items-center justify-between">
                <span>
                  #{active.seq} · {active.status}
                </span>
                {active.tmScore != null && (
                  <span className="font-mono text-[12px] text-[var(--color-text-tertiary)]">
                    TM {(active.tmScore * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <label className="field-label">{t('job:editor.source')}</label>
              <div className="source-panel">{active.sourceText}</div>
              <label className="field-label mt-3" htmlFor="target-text">
                {t('job:editor.target')}
              </label>
              <textarea
                id="target-text"
                ref={targetRef}
                className="field-input target-panel"
                rows={8}
                value={targetValue}
                onChange={(e) => onTargetChange(e.target.value)}
                readOnly={!canEdit}
                onFocus={() => setEditing(true)}
                placeholder={canEdit ? t('job:editor.targetPlaceholder') : undefined}
              />
            </>
          ) : (
            <EmptyState title={t('job:editor.pickSegment')} className="py-16" />
          )}
        </section>

        <aside className="editor-col side-col app-card">
          <div className="side-tabs">
            {(['qa', 'history', 'version', 'comment'] as SideTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={sideTab === tab ? 'side-tab active' : 'side-tab'}
                onClick={() => setSideTab(tab)}
              >
                {t(`job:editor.tab.${tab}`)}
                {tab === 'version' || tab === 'comment' ? (
                  <span className="phase2-chip">{t('common:phase2')}</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="side-tab-body">
            {sideTab === 'qa' && (
              <QaIssuePanel
                issues={active?.qaIssues ?? []}
                compact
                onResolve={canResolve || canApplyQa ? handleResolve : undefined}
                resolvingId={resolveIssue.isPending ? resolveIssue.variables?.issueId : null}
                onOverride={canOverride ? handleOverride : undefined}
                overridingId={overrideIssue.isPending ? overrideIssue.variables?.issueId : null}
                overrideError={overrideIssue.isError ? (overrideIssue.error instanceof ApiError ? overrideIssue.error.message : undefined) : undefined}
              />
            )}
            {sideTab === 'history' && (
              <HistoryPanel workspaceId={workspaceId} segmentId={activeSegmentId} />
            )}
            {sideTab === 'version' && (
              <EmptyState
                title={t('job:editor.versionPreview')}
                description={t('job:editor.versionPreviewDesc')}
                className="py-10"
              />
            )}
            {sideTab === 'comment' && (
              <EmptyState
                title={t('job:editor.commentPreview')}
                description={t('job:editor.commentPreviewDesc')}
                className="py-10"
              />
            )}
          </div>
        </aside>
      </div>

      <div className="editor-bottom-bar">
        <div className="status-bar text-[12px] text-[var(--color-text-secondary)]">
          {saveStatus === 'saving' && t('job:editor.saving')}
          {saveStatus === 'unsaved' && (
            <span className="text-[var(--color-severity-high)]">{t('job:editor.unsaved')}</span>
          )}
          {saveStatus === 'saved' &&
            active &&
            lastSavedAt[active.id] &&
            t('job:editor.saved', {
              relative: formatRelativeTime(
                new Date(lastSavedAt[active.id]).toISOString(),
                language,
              ),
            })}
          {!saveStatus && t('job:editor.ready')}
          {!canStartJob && canEdit && (
            <span className="ml-2 text-[var(--color-text-tertiary)]">
              · {t('job:editor.roleHint')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canApplyQa && active && (
            <button
              type="button"
              className="btn-secondary"
              disabled={!openIssues(active.qaIssues).some((i) => i.suggestion)}
              onClick={handleApplyFirstQa}
            >
              <IconSparkles size={16} />
              {t('job:editor.applyQa')}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={!filtered.length}
            onClick={() => moveActive(1)}
          >
            {t('job:editor.next')}
          </button>
          {canApprove && (
            <button
              type="button"
              className="btn-primary"
              disabled={
                !active ||
                approveSeg.isPending ||
                isApprovalBlocked(active.qaIssues) ||
                !targetValue.trim()
              }
              title={
                active && isApprovalBlocked(active.qaIssues)
                  ? t('job:editor.approveBlocked')
                  : undefined
              }
              onClick={() => void handleApprove()}
            >
              <IconCheck size={16} />
              {t('job:editor.approve')}
            </button>
          )}
        </div>
      </div>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={t('job:editor.shortcutsTitle')}
        description={t('job:editor.shortcutsDesc')}
        size="lg"
        footer={
          <button type="button" className="btn-primary" onClick={() => setHelpOpen(false)}>
            {t('common:actions.close')}
          </button>
        }
      >
        <table className="dd-table">
          <tbody>
            {SHORTCUTS.map((row) => (
              <tr key={row.keys}>
                <td className="font-mono text-[12px]">{row.keys}</td>
                <td>{t(row.labelKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  )
}

const PIPELINE = [
  'queued',
  'tm',
  'translating',
  'qa',
  'autoFix',
  'awaitingReview',
  'approved',
] as const

type PipelineStep = (typeof PIPELINE)[number]

function mapPipeline(
  jobStatus: string | undefined,
  active: SegmentItem | null,
): PipelineStep {
  if (active?.status === 'APPROVED') return 'approved'
  if (active?.status === 'QA_FLAGGED') return 'awaitingReview'
  if (active?.status === 'TRANSLATED') return 'awaitingReview'
  if (String(jobStatus).toUpperCase() === 'PROCESSING') return 'translating'
  if (String(jobStatus).toUpperCase() === 'PENDING') return 'queued'
  if (String(jobStatus).toUpperCase() === 'COMPLETED') return 'awaitingReview'
  return 'queued'
}

const SHORTCUTS = [
  { keys: '↑ / ↓', labelKey: 'job:shortcuts.prevNext' },
  { keys: 'Enter', labelKey: 'job:shortcuts.edit' },
  { keys: 'Esc', labelKey: 'job:shortcuts.escape' },
  { keys: 'Ctrl/Cmd+S', labelKey: 'job:shortcuts.save' },
  { keys: 'Ctrl/Cmd+Enter', labelKey: 'job:shortcuts.approve' },
  { keys: 'G', labelKey: 'job:shortcuts.applyQa' },
  { keys: '/', labelKey: 'job:shortcuts.search' },
  { keys: '?', labelKey: 'job:shortcuts.help' },
] as const
