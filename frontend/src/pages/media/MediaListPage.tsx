import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconChevronDown,
  IconChevronLeft,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconVideo,
} from '@tabler/icons-react'
import { MediaStudioNav } from '@/components/media-studio/MediaStudioNav'
import { UploadConsentPanel } from '@/components/media-studio/UploadConsentPanel'
import { JobsTable } from '@/components/media-studio/JobsTable'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMediaJobs, useProjectMediaAssets } from '@/hooks/useMedia'
import { useProjects } from '@/hooks/useProjects'
import { useRecordProjectVisit } from '@/hooks/useRecentProjects'
import { cn } from '@/lib/cn'
import { formatLanguageOption } from '@/lib/languages'
import { useUiStore } from '@/store/uiStore'

export { JobsTable }

/**
 * Media Studio hub (M8) — 2 views:
 * #overview (job list with filters & quick chips)
 * #upload (create job wizard)
 */
export function MediaListPage() {
  const { t } = useTranslation(['media', 'common'])
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const language = useUiStore((s) => s.language)

  const { data: projects = [] } = useProjects(workspaceId)
  // Accept both ?project= (canonical) and ?projectId= (links from dashboard / project list).
  const projectFromUrl = searchParams.get('project') || searchParams.get('projectId') || ''
  const [projectId, setProjectId] = useState(projectFromUrl)

  const hashPanel = location.hash.replace(/^#/, '')
  const initialPanel = hashPanel === 'upload' ? 'upload' : 'overview'
  const [openPanel, setOpenPanel] = useState<string | null>(initialPanel)
  const [page, setPage] = useState(0)

  const initialPageSize = Number(searchParams.get('pageSize')) || 10
  const [pageSize, setPageSize] = useState(initialPageSize)

  useDocumentTitle(t('media:title'))

  const {
    data: jobs = [],
    isLoading,
    isFetching,
    refetch,
  } = useMediaJobs(workspaceId, projectId || undefined)
  const { data: assets = [] } = useProjectMediaAssets(workspaceId, projectId || undefined)

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  )

  useRecordProjectVisit(workspaceId, selectedProject?.id, selectedProject?.name)

  // Auto-select when workspace has only 1 project
  useEffect(() => {
    if (!projectId && projects.length === 1) {
      handleSelectProject(projects[0].id)
    }
  }, [projects, projectId])

  // Reset page when project or job list size changes.
  useEffect(() => {
    setPage(0)
  }, [projectId, jobs.length])

  // Sync projectId with URL search parameter (?project=... or ?projectId=...)
  useEffect(() => {
    const urlProj = searchParams.get('project') || searchParams.get('projectId') || ''
    if (urlProj !== projectId) {
      setProjectId(urlProj)
    }
  }, [searchParams])

  // Sync openPanel with URL hash (#overview, #upload)
  useEffect(() => {
    const h = location.hash.replace(/^#/, '')
    if (h === 'upload') {
      setOpenPanel('upload')
    } else if (h === 'overview' || !h) {
      setOpenPanel('overview')
    }
  }, [location.hash])

  const handleSelectProject = (newId: string) => {
    setProjectId(newId)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (newId) {
          next.set('project', newId)
          next.delete('projectId')
        } else {
          next.delete('project')
          next.delete('projectId')
        }
        return next
      },
      { replace: true },
    )
  }

  const pickProject = (nextVal: string) => {
    handleSelectProject(nextVal)
    setOpenPanel('overview')
    const nextSearch = new URLSearchParams(location.search)
    if (nextVal) {
      nextSearch.set('project', nextVal)
      nextSearch.delete('projectId')
    } else {
      nextSearch.delete('project')
      nextSearch.delete('projectId')
    }
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch.toString() ? `?${nextSearch.toString()}` : '',
        hash: '#overview',
      },
      { replace: true },
    )
  }

  const handleFilterChange = (filters: {
    search: string
    status: string
    targetLang: string
    mode: string
    sortBy: string
  }) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (filters.status && filters.status !== 'ALL') next.set('status', filters.status)
        else next.delete('status')

        if (filters.search) next.set('search', filters.search)
        else next.delete('search')

        if (filters.targetLang && filters.targetLang !== 'ALL') next.set('lang', filters.targetLang)
        else next.delete('lang')

        if (filters.mode && filters.mode !== 'ALL') next.set('mode', filters.mode)
        else next.delete('mode')

        if (filters.sortBy && filters.sortBy !== 'created_desc') next.set('sort', filters.sortBy)
        else next.delete('sort')

        return next
      },
      { replace: true },
    )
  }

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize)
    setPage(0)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (newSize !== 10) next.set('pageSize', String(newSize))
        else next.delete('pageSize')
        return next
      },
      { replace: true },
    )
  }

  return (
    <div className="media-studio-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <IconVideo size={26} className="text-[var(--color-media)]" />
            {t('media:title')}
          </h1>
        </div>
      </div>

      <MediaStudioNav />

      {/* Prominent Project Picker below tabs (A4) */}
      <div className="media-project-picker mb-4">
        {/* The project name itself is the switcher (native select, styled as a title). */}
        <label className={cn('media-project-switcher', !selectedProject && 'empty')}>
          <IconFolder size={18} className="media-project-switcher__icon" aria-hidden />
          <select
            className="media-project-switcher__select"
            value={projectId}
            onChange={(e) => pickProject(e.target.value)}
            aria-label={t('media:selectProject')}
          >
            <option value="">{t('media:selectProjectPlaceholder')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <IconChevronDown size={16} className="media-project-switcher__caret" aria-hidden />
        </label>
        {selectedProject ? (
          <div className="media-project-tags">
            <span
              className="media-project-tag"
              title={formatLanguageOption(selectedProject.sourceLang, language)}
            >
              {t('media:projectSourceShort')}: <strong>{selectedProject.sourceLang?.toUpperCase()}</strong>
            </span>
            {selectedProject.domain && (
              <span className="media-project-tag">
                {t('media:projectDomain')}: <strong>{selectedProject.domain}</strong>
              </span>
            )}
          </div>
        ) : (
          <span className="media-project-picker-hint">{t('media:noProjectDesc')}</span>
        )}
        {projectId && openPanel === 'overview' && (
          <div className="media-project-picker-actions">
            <button
              type="button"
              className="btn-secondary media-project-picker-icon-btn"
              title={t('common:refresh')}
              aria-label={t('common:refresh')}
              data-testid="media-refresh"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <IconRefresh size={16} className={isFetching ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="btn-primary"
              data-testid="media-new-job"
              onClick={() => {
                setOpenPanel('upload')
                navigate(
                  {
                    pathname: location.pathname,
                    search: location.search,
                    hash: '#upload',
                  },
                  { replace: true },
                )
              }}
            >
              <IconPlus size={16} />
              {t('media:newJob')}
            </button>
          </div>
        )}
      </div>

      {!projectId ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-1)] p-8 text-center mt-4">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-bg-surface-3)] text-[var(--color-media)]">
            <IconFolder size={30} />
          </div>
          <h2 className="text-base font-semibold">{t('media:noProjectTitle')}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-text-secondary)]">
            {t('media:noProjectDesc')}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          {/* #overview view: Jobs List */}
          <div
            data-section-id="overview"
            data-open={openPanel === 'overview' ? 'true' : 'false'}
            hidden={openPanel !== 'overview'}
            className={openPanel !== 'overview' ? 'hidden' : ''}
          >
            <JobsTable
              workspaceId={workspaceId}
              projectId={projectId}
              jobs={jobs}
              assets={assets}
              isLoading={isLoading}
              language={language}
              page={page}
              pageSize={pageSize}
              pageSizeOptions={[8, 10, 20, 50]}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
              onOpen={(id) => navigate(`/w/${workspaceId}/media/jobs/${id}`)}
              onRefresh={() => void refetch()}
              onCreateNew={() => {
                setOpenPanel('upload')
                navigate(
                  {
                    pathname: location.pathname,
                    search: location.search,
                    hash: '#upload',
                  },
                  { replace: true },
                )
              }}
              initialSearch={searchParams.get('search') || ''}
              initialStatus={searchParams.get('status') || 'ALL'}
              initialLang={searchParams.get('lang') || 'ALL'}
              initialMode={searchParams.get('mode') || 'ALL'}
              initialSort={(searchParams.get('sort') as any) || 'created_desc'}
              onFilterChange={handleFilterChange}
            />
          </div>

          {/* #upload view: Create Job Form */}
          <div
            data-section-id="upload"
            data-open={openPanel === 'upload' ? 'true' : 'false'}
            hidden={openPanel !== 'upload'}
            className={openPanel !== 'upload' ? 'hidden' : ''}
          >
            <div className="mb-4">
              <button
                type="button"
                className="btn-ghost btn-sm inline-flex items-center gap-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                onClick={() => {
                  setOpenPanel('overview')
                  navigate(
                    {
                      pathname: location.pathname,
                      search: location.search,
                      hash: '#overview',
                    },
                    { replace: true },
                  )
                }}
              >
                <IconChevronLeft size={16} />
                <span>{t('media:backToList')}</span>
              </button>
            </div>
            <UploadConsentPanel
              workspaceId={workspaceId}
              projectId={projectId}
              onCreated={() => {
                setOpenPanel('overview')
                navigate(
                  {
                    pathname: location.pathname,
                    search: location.search,
                    hash: '#overview',
                  },
                  { replace: true },
                )
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
