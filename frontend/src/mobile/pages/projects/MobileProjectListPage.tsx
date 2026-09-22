import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  IconAlertCircle,
  IconDotsVertical,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconVideo,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileActionMenu } from '../../components/MobileActionMenu'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useProjects, useCreateProject } from '@/hooks/useProjects'
import { LANG_OPTIONS, getLanguageName } from '@/lib/languages'

export function MobileProjectListPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()

  const { data: projects, isLoading, error, refetch } = useProjects(workspaceId)
  const createMutation = useCreateProject(workspaceId)

  const [search, setSearch] = useState('')
  const [createSheetOpen, setCreateSheetOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newSourceLang, setNewSourceLang] = useState('en')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null)

  const filtered = (projects ?? []).filter((p) => {
    const term = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(term) ||
      (p.domain && p.domain.toLowerCase().includes(term)) ||
      p.sourceLang.toLowerCase().includes(term)
    )
  })

  const handleOpenCreate = () => {
    setNewProjectName('')
    setNewSourceLang('en')
    setFormError(null)
    setCreateSheetOpen(true)
  }

  const handleCreate = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = newProjectName.trim()
    if (!trimmed) {
      setFormError('Vui lòng nhập tên dự án')
      return
    }

    setFormError(null)
    createMutation.mutate(
      { name: trimmed, sourceLang: newSourceLang },
      {
        onSuccess: (created) => {
          setCreateSheetOpen(false)
          setNewProjectName('')
          setNewSourceLang('en')
          if (created?.id) {
            navigate(`/w/${workspaceId}/media?projectId=${created.id}`)
          }
        },
        onError: (err: any) => {
          setFormError(err?.message || 'Có lỗi xảy ra khi tạo dự án')
        },
      }
    )
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">Dự án</h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {projects ? `${projects.length} dự án` : 'Quản lý dự án'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          aria-label="Tạo dự án mới"
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold whitespace-nowrap text-white shadow-xs active:scale-95 transition-transform"
        >
          <IconPlus size={16} />
          <span>Tạo mới</span>
        </button>
      </div>

      {/* Search Filter */}
      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm kiếm dự án..."
      />

      {/* Loading State */}
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="text-center text-sm text-neutral-400 py-6">
            Đang tải danh sách dự án...
          </div>
          {[1, 2, 3].map((i) => (
            <MobileCard key={i} className="animate-pulse space-y-3 p-4">
              <div className="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/3 rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-2 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="text-red-500 mb-2" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Không thể tải danh sách dự án
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {(error as any)?.message || 'Vui lòng kiểm tra lại kết nối mạng'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200"
          >
            <IconRefresh size={14} />
            <span>Thử lại</span>
          </button>
        </MobileCard>
      ) : (projects ?? []).length === 0 ? (
        <MobileEmptyState
          icon={<IconFolder size={36} />}
          title="Chưa có dự án nào"
          description="Bắt đầu tổ chức các tệp dịch thuật bằng cách tạo dự án đầu tiên."
          action={
            <button
              type="button"
              onClick={handleOpenCreate}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              Tạo dự án
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconFolder size={36} />}
          title="Không tìm thấy dự án"
          description="Không có dự án nào khớp với từ khóa tìm kiếm."
          action={
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              Xóa tìm kiếm
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((proj) => {
            const mediaCount = proj.mediaCount ?? 0
            const progress = proj.progressPercent ?? 0
            const targetUrl = `/w/${workspaceId}/media?projectId=${proj.id}`

            return (
              <MobileCard key={proj.id} className="min-w-0 space-y-3 p-4">
                {/* Header row */}
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <Link
                    to={targetUrl}
                    className="font-semibold text-sm text-neutral-900 dark:text-white hover:text-primary transition-colors flex-1 min-w-0 truncate"
                  >
                    {proj.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSelectedProject({ id: proj.id, name: proj.name })}
                    aria-label={`Thao tác dự án ${proj.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center -mr-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-lg active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <IconDotsVertical size={18} />
                  </button>
                </div>

                {/* Info row */}
                <div className="flex min-w-0 items-center flex-wrap gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="shrink-0 font-mono font-semibold uppercase bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 px-2 py-0.5 rounded text-[11px]">
                    {proj.sourceLang.toUpperCase()}
                  </span>
                  <div className="flex min-w-0 items-center gap-1">
                    <IconVideo size={14} className="shrink-0 text-neutral-400" />
                    <span className="truncate whitespace-nowrap">{mediaCount} media</span>
                  </div>
                  {proj.domain && (
                    <span className="min-w-0 truncate max-w-full rounded bg-neutral-50 dark:bg-neutral-800 px-1.5 py-0.5 text-neutral-400 border border-neutral-100 dark:border-neutral-800 text-[11px]">
                      {proj.domain}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
                    <span>Tiến độ</span>
                    <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                      {progress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    />
                  </div>
                </div>
              </MobileCard>
            )
          })}
        </div>
      )}

      {/* Action Menu BottomSheet */}
      {selectedProject && (
        <MobileActionMenu
          isOpen={Boolean(selectedProject)}
          onClose={() => setSelectedProject(null)}
          title={selectedProject.name}
          actions={[
            {
              label: 'Xem media / tài liệu',
              icon: <IconVideo size={18} />,
              onClick: () => {
                navigate(`/w/${workspaceId}/media?projectId=${selectedProject.id}`)
              },
            },
          ]}
        />
      )}

      {/* Create Project BottomSheet */}
      <BottomSheet
        isOpen={createSheetOpen}
        onClose={() => {
          if (!createMutation.isPending) {
            setCreateSheetOpen(false)
          }
        }}
        title="Tạo dự án mới"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50">
              {formError}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Tên dự án <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => {
                setNewProjectName(e.target.value)
                if (formError) setFormError(null)
              }}
              placeholder="Tên dự án (VD: Video marketing Q4)"
              autoFocus
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Ngôn ngữ nguồn
            </label>
            <select
              value={newSourceLang}
              onChange={(e) => setNewSourceLang(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 text-sm text-neutral-900 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            >
              {LANG_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {code.toUpperCase()} — {getLanguageName(code, 'vi')}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {createMutation.isPending ? 'Đang tạo...' : 'Tạo dự án'}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  )
}
