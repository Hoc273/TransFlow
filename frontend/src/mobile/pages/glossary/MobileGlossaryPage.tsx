import { useMemo, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  IconAlertCircle,
  IconBook,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useAddTerm, useDeleteTerm, useGlossaryTerms } from '@/hooks/useGlossary'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { ApiError } from '@/types/api'
import type { GlossaryTerm } from '@/types/glossary'

const EMPTY_TERMS: GlossaryTerm[] = []

export function MobileGlossaryPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const canEdit = usePermission('glossary.crud')
  const projectsQuery = useProjects(workspaceId)
  const projects = projectsQuery.data ?? []
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const activeProjectId = selectedProjectId && projects.some((p) => p.id === selectedProjectId)
    ? selectedProjectId
    : projects[0]?.id
  const activeProject = projects.find((p) => p.id === activeProjectId)

  const termsQuery = useGlossaryTerms(workspaceId, activeProjectId)
  const terms = termsQuery.data ?? EMPTY_TERMS
  const addTerm = useAddTerm(workspaceId, activeProjectId)
  const deleteTerm = useDeleteTerm(workspaceId, activeProjectId)

  const [search, setSearch] = useState('')
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [targetLang, setTargetLang] = useState('all')
  const [formError, setFormError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return terms
    return terms.filter(
      (term) =>
        term.sourceTerm.toLowerCase().includes(query) ||
        term.targetTerm.toLowerCase().includes(query) ||
        term.targetLang.toLowerCase().includes(query),
    )
  }, [search, terms])

  const isLoading = projectsQuery.isLoading || Boolean(activeProjectId && termsQuery.isLoading)
  const error = projectsQuery.error ?? termsQuery.error

  const handleOpenAdd = () => {
    setSource('')
    setTarget('')
    setTargetLang('all')
    setFormError(null)
    setAddSheetOpen(true)
  }

  const handleAdd = (event: FormEvent) => {
    event.preventDefault()
    const sourceTerm = source.trim()
    const targetTerm = target.trim()
    const normalizedTargetLang = targetLang.trim()
    if (!sourceTerm || !targetTerm || !normalizedTargetLang) {
      setFormError('Vui lòng nhập đầy đủ thuật ngữ nguồn, đích và ngôn ngữ đích')
      return
    }

    setFormError(null)
    addTerm.mutate(
      { sourceTerm, targetTerm, targetLang: normalizedTargetLang },
      {
        onSuccess: () => {
          setAddSheetOpen(false)
          setSource('')
          setTarget('')
          setTargetLang('all')
        },
        onError: (mutationError) => {
          setFormError(
            mutationError instanceof ApiError ? mutationError.message : 'Không thể thêm thuật ngữ',
          )
        },
      },
    )
  }

  const handleRetry = () => {
    void projectsQuery.refetch()
    if (activeProjectId) void termsQuery.refetch()
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">
            Từ điển thuật ngữ
          </h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {activeProject ? `${activeProject.name} • ` : ''}
            {terms.length} thuật ngữ
          </p>
        </div>
        {canEdit && activeProjectId && (
          <button
            type="button"
            onClick={handleOpenAdd}
            aria-label="Thêm từ"
            className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
          >
            <IconPlus size={16} />
            <span>Thêm từ</span>
          </button>
        )}
      </div>

      {projects.length > 0 && (
        <select
          aria-label="Chọn dự án"
          value={activeProjectId ?? ''}
          onChange={(event) => setSelectedProjectId(event.target.value)}
          className="h-10 w-full min-w-0 truncate rounded-xl border border-neutral-200 bg-neutral-50/50 p-2.5 text-xs font-medium text-neutral-900 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}

      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm thuật ngữ..."
      />

      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="py-6 text-center text-sm text-neutral-400">Đang tải thuật ngữ...</div>
          {[1, 2, 3].map((item) => (
            <MobileCard key={item} className="animate-pulse space-y-2 p-3">
              <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/3 rounded bg-neutral-100 dark:bg-neutral-800" />
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="mb-2 text-red-500" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Không thể tải thuật ngữ
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {error instanceof Error ? error.message : 'Vui lòng kiểm tra lại kết nối mạng'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <IconRefresh size={14} />
            <span>Thử lại</span>
          </button>
        </MobileCard>
      ) : projects.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title="Chưa có dự án"
          description="Tạo dự án trước để quản lý bảng thuật ngữ riêng của dự án."
        />
      ) : terms.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title="Chưa có thuật ngữ nào"
          description="Thêm cặp thuật ngữ chuyên ngành để chuẩn hóa bản dịch tự động."
          action={canEdit ? (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              Thêm thuật ngữ
            </button>
          ) : undefined}
        />
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title="Không tìm thấy thuật ngữ"
          description="Không có thuật ngữ nào khớp với từ khóa tìm kiếm."
          action={
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-xl bg-neutral-100 px-4 py-2 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              Xóa tìm kiếm
            </button>
          }
        />
      ) : (
        <div className="min-w-0 space-y-2.5">
          {filtered.map((term) => (
            <MobileCard key={term.id} className="min-w-0 space-y-2 p-3.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-semibold text-neutral-900 dark:text-white">
                      {term.sourceTerm}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-neutral-400">→</span>
                    <span className="min-w-0 truncate text-sm font-semibold text-primary">
                      {term.targetTerm}
                    </span>
                  </div>
                  <span className="inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary dark:bg-primary/20">
                    {term.targetLang}
                  </span>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => deleteTerm.mutate(term.id)}
                    aria-label={`Xóa thuật ngữ ${term.sourceTerm}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-all hover:text-red-500 active:scale-95 active:bg-red-50 dark:active:bg-red-950/30"
                  >
                    <IconTrash size={16} />
                  </button>
                )}
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      <BottomSheet
        isOpen={addSheetOpen}
        onClose={() => !addTerm.isPending && setAddSheetOpen(false)}
        title="Thêm thuật ngữ mới"
      >
        <form onSubmit={handleAdd} className="space-y-3">
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
              {formError}
            </div>
          )}
          <label className="block space-y-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <span>Thuật ngữ nguồn *</span>
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm font-normal focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <span>Thuật ngữ đích *</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm font-normal focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <span>Ngôn ngữ đích *</span>
            <input
              value={targetLang}
              onChange={(event) => setTargetLang(event.target.value)}
              placeholder="vi / en / all"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm font-normal focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </label>
          <button
            type="submit"
            disabled={addTerm.isPending}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-xs transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {addTerm.isPending ? 'Đang lưu...' : 'Lưu thuật ngữ'}
          </button>
        </form>
      </BottomSheet>
    </div>
  )
}
