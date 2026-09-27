import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCreateWorkspace, useWorkspaces } from '@/hooks/useWorkspaces'
import { useLogout } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ApiError } from '@/types/api'

/** Post-login landing when the user has zero workspaces. */
export function NoWorkspacePage() {
  const { t } = useTranslation(['common', 'auth'])
  useDocumentTitle(t('common:workspace.noWorkspaceTitle'))
  const navigate = useNavigate()
  const logout = useLogout()
  const [searchParams] = useSearchParams()
  const isPreview = searchParams.get('preview') === 'true'

  const { data: workspaces } = useWorkspaces()
  const createWs = useCreateWorkspace()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isPreview && workspaces?.length) {
      navigate(`/w/${workspaces[0].id}`, { replace: true })
    }
  }, [workspaces, navigate, isPreview])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('common:workspace.nameRequired'))
      return
    }
    createWs.mutate(
      { name: trimmed },
      {
        onSuccess: (ws) => navigate(`/w/${ws.id}`, { replace: true }),
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-app)] px-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">
          {t('common:workspace.noWorkspaceTitle')}
        </h1>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">
          {t('common:workspace.noWorkspaceDesc')}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--color-text-primary)]">
              {t('common:workspace.nameLabel')}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
              placeholder={t('common:workspace.namePlaceholder')}
              autoFocus
            />
          </label>
          {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
          <button
            type="submit"
            disabled={createWs.isPending}
            className="w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {createWs.isPending
              ? t('common:workspace.creating')
              : t('common:workspace.create')}
          </button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="mt-6 w-full border-none bg-transparent text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
        >
          {t('common:logout')}
        </button>
      </div>
    </div>
  )
}
