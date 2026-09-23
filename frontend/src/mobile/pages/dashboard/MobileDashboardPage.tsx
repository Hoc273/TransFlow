import { Link, useParams } from 'react-router-dom'
import {
  IconArrowRight,
  IconBook2,
  IconChevronRight,
  IconCpu,
  IconFolder,
  IconLayersLinked,
  IconSparkles,
  IconVideo,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { useProjects } from '@/hooks/useProjects'
import { useBatches } from '@/hooks/useBatches'
import { useUsage } from '@/hooks/useUsage'
import { useAuthStore } from '@/store/authStore'

export function MobileDashboardPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)

  const { data: projects, isLoading: isProjectsLoading } = useProjects(workspaceId)
  const { data: batches, isLoading: isBatchesLoading } = useBatches(workspaceId)
  const { data: usage, isLoading: isUsageLoading } = useUsage(workspaceId)

  const recentProjects = (projects ?? []).slice(0, 5)

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Workspace Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {workspaceName || 'Không gian làm việc'}
          </span>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Tổng quan</h1>
        </div>
        <Link
          to={`/w/${workspaceId}/dashboard/usage`}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary dark:bg-primary/20 hover:bg-primary/15 transition-colors"
        >
          <IconSparkles size={14} />
          <span className="whitespace-nowrap">Hạn ngạch AI</span>
        </Link>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid min-w-0 grid-cols-2 gap-2.5">
        <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
            <span className="truncate text-xs font-medium">Dự án</span>
            <IconFolder size={18} className="shrink-0 text-blue-500" />
          </div>
          <span className="truncate text-2xl font-bold tabular-nums text-neutral-900 dark:text-white">
            {isProjectsLoading ? '...' : (projects?.length ?? 0)}
          </span>
          <span className="truncate text-[11px] text-neutral-400">Tổng số dự án</span>
        </MobileCard>

        <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
            <span className="truncate text-xs font-medium">Lô dịch</span>
            <IconLayersLinked size={18} className="shrink-0 text-indigo-500" />
          </div>
          <span className="truncate text-2xl font-bold tabular-nums text-neutral-900 dark:text-white">
            {isBatchesLoading ? '...' : (batches?.length ?? 0)}
          </span>
          <span className="truncate text-[11px] text-neutral-400">Lô tài liệu xử lý</span>
        </MobileCard>

        <MobileCard className="col-span-2 flex min-w-0 flex-col gap-1 p-3 bg-gradient-to-br from-white to-primary/5 dark:from-neutral-900 dark:to-primary/10">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
            <span className="truncate text-xs font-medium">Token AI đã dùng</span>
            <IconCpu size={18} className="shrink-0 text-purple-500" />
          </div>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-2xl font-bold tabular-nums text-neutral-900 dark:text-white">
              {isUsageLoading
                ? '...'
                : usage?.totalTokens != null
                ? usage.totalTokens.toLocaleString('vi-VN')
                : 0}
            </span>
            <span className="shrink-0 text-xs text-neutral-400 font-medium">tokens</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-neutral-100 dark:border-neutral-800 text-[11px]">
            <span className="text-neutral-500 dark:text-neutral-400">
              Lượt gọi: <strong className="text-neutral-700 dark:text-neutral-200">{usage?.operationCount ?? 0}</strong>
            </span>
            <Link
              to={`/w/${workspaceId}/dashboard/usage`}
              className="flex items-center gap-0.5 font-semibold text-primary hover:underline"
            >
              <span>Chi tiết</span>
              <IconChevronRight size={12} />
            </Link>
          </div>
        </MobileCard>
      </div>

      {/* Quick Launch Buttons */}
      <div className="min-w-0 space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Truy cập nhanh</h2>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <Link
            to={`/w/${workspaceId}/projects`}
            aria-label="Dự án"
            className="flex min-h-[56px] min-w-0 items-center gap-2.5 rounded-xl border border-neutral-200/80 bg-white p-3 text-neutral-800 shadow-xs transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <IconFolder size={18} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-xs font-semibold">Dự án</span>
              <span className="truncate text-[10px] text-neutral-400">Quản lý dự án</span>
            </div>
          </Link>


          <Link
            to={`/w/${workspaceId}/media`}
            aria-label="Media"
            className="flex min-h-[56px] min-w-0 items-center gap-2.5 rounded-xl border border-neutral-200/80 bg-white p-3 text-neutral-800 shadow-xs transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
              <IconVideo size={18} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-xs font-semibold">Media</span>
              <span className="truncate text-[10px] text-neutral-400">Video & Voice</span>
            </div>
          </Link>

          <Link
            to={`/w/${workspaceId}/glossaries`}
            aria-label="Thuật ngữ"
            className="flex min-h-[56px] min-w-0 items-center gap-2.5 rounded-xl border border-neutral-200/80 bg-white p-3 text-neutral-800 shadow-xs transition-all active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <IconBook2 size={18} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate text-xs font-semibold">Thuật ngữ</span>
              <span className="truncate text-[10px] text-neutral-400">Từ điển thuật ngữ</span>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Projects List */}
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold text-neutral-700 dark:text-neutral-300">Dự án gần đây</h2>
          <Link
            to={`/w/${workspaceId}/projects`}
            className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
          >
            <span className="whitespace-nowrap">Xem tất cả</span>
            <IconArrowRight size={12} />
          </Link>
        </div>

        {isProjectsLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <MobileCard key={i} className="animate-pulse py-4 px-3">
                <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="mt-2 h-3 w-1/2 rounded bg-neutral-100 dark:bg-neutral-800" />
              </MobileCard>
            ))}
          </div>
        ) : recentProjects.length > 0 ? (
          <div className="space-y-2">
            {recentProjects.map((p) => (
              <Link
                key={p.id}
                to={`/w/${workspaceId}/media?projectId=${p.id}`}
                className="block no-underline"
              >
                <MobileCard interactive className="flex items-center justify-between py-3 px-3.5">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-neutral-900 dark:text-white">
                        {p.name}
                      </span>
                      <span className="shrink-0 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 dark:text-neutral-300 uppercase">
                        {p.sourceLang || '—'}
                      </span>
                    </div>
                    {p.domain && (
                      <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
                        {p.domain}
                      </span>
                    )}
                  </div>
                  <IconChevronRight size={16} className="shrink-0 text-neutral-400" />
                </MobileCard>
              </Link>
            ))}
          </div>
        ) : (
          <MobileCard className="py-6 text-center text-xs text-neutral-400">
            <span>Chưa có dự án nào gần đây</span>
            <div className="mt-2">
              <Link
                to={`/w/${workspaceId}/projects`}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <span>Tạo dự án mới</span>
                <IconArrowRight size={12} />
              </Link>
            </div>
          </MobileCard>
        )}
      </div>
    </div>
  )
}
