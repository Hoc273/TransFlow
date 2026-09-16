import { useState } from 'react'
import {
  IconBuilding,
  IconCheck,
  IconDoorExit,
  IconInfoCircle,
  IconPlus,
  IconSwitchHorizontal,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { initialsFromName } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/types/api'
import type { Workspace } from '@/types/workspace'

const WS_GRADIENTS = [
  'linear-gradient(135deg, #714ffc, #9333ea)',
  'linear-gradient(135deg, #10b981, #06b6d4)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #3b82f6, #6366f1)',
]

function gradientFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % WS_GRADIENTS.length
  return WS_GRADIENTS[h] ?? WS_GRADIENTS[0]
}

/**
 * Workspaces Section — High-end workspace management & switching.
 */
export function WorkspacesSection() {
  const { t } = useTranslation(['account', 'common', 'settings'])
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const setCurrentWorkspace = useAuthStore((s) => s.setCurrentWorkspace)
  const { data: workspaces = [], isLoading, isError, error, refetch } = useWorkspaces()
  const [createOpen, setCreateOpen] = useState(false)
  const [leaveNote, setLeaveNote] = useState<string | null>(null)

  const switchTo = (ws: Workspace) => {
    setCurrentWorkspace(ws)
    navigate(`/w/${ws.id}/account/workspaces`)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-border)] pb-5 mb-5">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <IconBuilding size={16} className="text-[var(--color-accent)]" />
              {t('account:ws.title')}
              {!isLoading && workspaces.length > 0 && (
                <span className="rounded-full bg-[var(--color-bg-surface-3)] px-2 py-0.5 text-[11px] font-mono text-[var(--color-text-tertiary)]">
                  {workspaces.length}
                </span>
              )}
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">
              {t('account:ws.desc')}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary btn-sm flex items-center gap-1.5 self-start sm:self-auto text-xs shadow-xs"
            onClick={() => setCreateOpen(true)}
          >
            <IconPlus size={14} />
            <span>{t('account:ws.create')}</span>
          </button>
        </div>

        {leaveNote && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] px-3.5 py-2.5 text-xs text-[var(--color-accent)] animate-in fade-in">
            <IconInfoCircle size={15} className="shrink-0" />
            <span>{leaveNote}</span>
          </div>
        )}

        {isLoading && (
          <div className="py-12 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <div className="my-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-error)]/25 bg-[var(--color-error-bg)] p-4 text-xs text-[var(--color-error)]">
            <span>
              {error instanceof ApiError ? error.message : t('common:error.loadFailed')}
            </span>
            <button
              type="button"
              className="btn-secondary btn-sm text-xs"
              onClick={() => void refetch()}
            >
              {t('common:retry')}
            </button>
          </div>
        )}

        {!isLoading && !isError && workspaces.length === 0 && (
          <div className="py-12 text-center text-xs text-[var(--color-text-secondary)]">
            {t('account:ws.empty')}
          </div>
        )}

        {!isLoading && workspaces.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {workspaces.map((ws) => {
              const isCurrent = ws.id === workspaceId
              return (
                <div
                  key={ws.id}
                  className={`group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border p-4 transition-all duration-150 ${
                    isCurrent
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/20 shadow-xs'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/50 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-surface-2)]'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
                      style={{ background: gradientFor(ws.id) }}
                    >
                      {initialsFromName(ws.name)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                          {ws.name}
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                            <IconCheck size={10} stroke={2.5} />
                            <span>{t('account:ws.current')}</span>
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="rounded-md bg-[var(--color-bg-surface-3)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] capitalize">
                          {t(`settings:roles.${ws.myRole}`, { defaultValue: ws.myRole })}
                        </span>
                        {ws.slug && (
                          <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
                            /{ws.slug}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {isCurrent ? (
                      <span className="rounded-lg bg-[var(--color-bg-surface-3)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-tertiary)]">
                        Workspace hiện tại
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-secondary btn-sm flex items-center gap-1.5 text-xs"
                          onClick={() => switchTo(ws)}
                        >
                          <IconSwitchHorizontal size={13} />
                          <span>{t('account:ws.switch')}</span>
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                          title={t('account:ws.leave')}
                          onClick={() => {
                            setLeaveNote(t('account:ws.leavePending'))
                            window.setTimeout(() => setLeaveNote(null), 3500)
                          }}
                        >
                          <IconDoorExit size={13} />
                          <span>{t('account:ws.leave')}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
        <IconInfoCircle size={14} className="shrink-0" />
        <span>{t('account:ws.wsSettingsNote')}</span>
      </div>

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
