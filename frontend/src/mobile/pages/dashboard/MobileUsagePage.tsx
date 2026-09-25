import { Link, useParams } from 'react-router-dom'
import {
  IconActivity,
  IconArrowDownRight,
  IconArrowLeft,
  IconArrowUpRight,
  IconCoin,
  IconLayersLinked,
  IconSparkles,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { useUsage } from '@/hooks/useUsage'

const OPERATION_LABELS: Record<string, { label: string; color: string }> = {
  TRANSLATE: { label: 'Dịch văn bản', color: 'bg-primary' },
  QA: { label: 'Kiểm tra chất lượng (LQA)', color: 'bg-sky-500' },
  EMBED: { label: 'Vector nhúng & TM', color: 'bg-amber-500' },
  SUMMARY: { label: 'Tóm tắt nội dung', color: 'bg-emerald-500' },
}

export function MobileUsagePage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const { data: usage, isLoading, isError } = useUsage(workspaceId, { groupBy: 'operation' })

  const totalTokens = usage?.totalTokens ?? 0

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Navigation Header */}
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to={`/w/${workspaceId}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200/80 bg-white text-neutral-600 active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
          aria-label="Quay lại Tổng quan"
        >
          <IconArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">Hạn ngạch & Mức sử dụng</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
            Thống kê tiêu thụ AI tokens trong không gian làm việc
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <MobileCard className="animate-pulse py-8 text-center text-xs text-neutral-400">
            Đang tải dữ liệu hạn ngạch & mức sử dụng...
          </MobileCard>
          <div className="grid grid-cols-2 gap-2.5">
            {[1, 2, 3, 4].map((i) => (
              <MobileCard key={i} className="animate-pulse p-4">
                <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="mt-2 h-6 w-3/4 rounded bg-neutral-100 dark:bg-neutral-800" />
              </MobileCard>
            ))}
          </div>
        </div>
      ) : isError ? (
        <MobileCard className="py-8 text-center text-xs text-red-500 dark:text-red-400">
          Không thể tải dữ liệu mức sử dụng AI. Vui lòng thử lại sau.
        </MobileCard>
      ) : (
        <>
          {/* Main Total Tokens Card */}
          <MobileCard className="flex min-w-0 flex-col gap-2 p-4 bg-gradient-to-br from-white to-primary/5 dark:from-neutral-900 dark:to-primary/10">
            <div className="flex min-w-0 items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
              <span className="truncate text-xs font-semibold uppercase tracking-wider">Tổng Tokens đã dùng</span>
              <IconSparkles size={20} className="shrink-0 text-primary" />
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-3xl font-extrabold tabular-nums text-neutral-900 dark:text-white">
                {totalTokens.toLocaleString('vi-VN')}
              </span>
              <span className="shrink-0 text-xs font-medium text-neutral-500">tokens</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1 pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs">
              <span className="text-neutral-500 dark:text-neutral-400">Tổng số lượt gọi API:</span>
              <span className="font-bold text-neutral-900 dark:text-white">
                {(usage?.operationCount ?? 0).toLocaleString('vi-VN')}
              </span>
            </div>
          </MobileCard>

          {/* Detailed Token Breakdown Cards */}
          <div className="grid min-w-0 grid-cols-2 gap-2.5">
            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">Input Tokens</span>
                <IconArrowDownRight size={18} className="shrink-0 text-sky-500" />
              </div>
              <span className="truncate text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
                {(usage?.totalInputTokens ?? 0).toLocaleString('vi-VN')}
              </span>
              <span className="truncate text-[10px] text-neutral-400">Dữ liệu gửi lên mô hình</span>
            </MobileCard>

            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">Output Tokens</span>
                <IconArrowUpRight size={18} className="shrink-0 text-purple-500" />
              </div>
              <span className="truncate text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
                {(usage?.totalOutputTokens ?? 0).toLocaleString('vi-VN')}
              </span>
              <span className="truncate text-[10px] text-neutral-400">Kết quả AI tạo ra</span>
            </MobileCard>

            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">Chi phí ước tính</span>
                <IconCoin size={18} className="shrink-0 text-amber-500" />
              </div>
              <span className="truncate text-base font-bold tabular-nums text-neutral-900 dark:text-white" title={usage?.cost ?? undefined}>
                {usage?.cost || 'Coming soon'}
              </span>
              <span className="truncate text-[10px] text-neutral-400">Áp dụng theo hạn mức gói</span>
            </MobileCard>

            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">Lượt gọi (Calls)</span>
                <IconActivity size={18} className="shrink-0 text-emerald-500" />
              </div>
              <span className="truncate text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
                {(usage?.operationCount ?? 0).toLocaleString('vi-VN')}
              </span>
              <span className="truncate text-[10px] text-neutral-400">Tổng số yêu cầu xử lý</span>
            </MobileCard>
          </div>

          {/* Breakdown By Operation */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Chi tiết theo tác vụ (Operations)
            </h2>
            {usage?.byOperation && usage.byOperation.length > 0 ? (
              <div className="space-y-2.5">
                {usage.byOperation.map((op) => {
                  const percent = totalTokens > 0 ? Math.round((op.totalTokens / totalTokens) * 100) : 0
                  const opMeta = OPERATION_LABELS[op.operation.toUpperCase()] || {
                    label: op.operation,
                    color: 'bg-neutral-500',
                  }

                  return (
                    <MobileCard key={op.operation} className="min-w-0 space-y-2.5 p-3.5">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${opMeta.color}`} />
                          <span className="truncate text-xs font-bold text-neutral-900 dark:text-white">
                            {op.operation}
                          </span>
                          <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                            ({opMeta.label})
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
                          {percent}%
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div
                          className={`h-full rounded-full ${opMeta.color}`}
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        <span className="truncate">
                          Tổng: <strong className="tabular-nums text-neutral-800 dark:text-neutral-200">{op.totalTokens.toLocaleString('vi-VN')}</strong>
                        </span>
                        <span className="truncate tabular-nums">
                          In: {op.inputTokens.toLocaleString('vi-VN')} | Out: {op.outputTokens.toLocaleString('vi-VN')}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          Lượt: {op.operationCount}
                        </span>
                      </div>
                    </MobileCard>
                  )
                })}
              </div>
            ) : (
              <MobileCard className="py-6 text-center text-xs text-neutral-400">
                Chưa có dữ liệu phân bổ theo tác vụ
              </MobileCard>
            )}
          </div>

          {/* Breakdown By Model */}
          {usage?.byModel && usage.byModel.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Chi tiết theo mô hình AI (Models)
              </h2>
              <div className="min-w-0 space-y-2">
                {usage.byModel.map((model, idx) => (
                  <MobileCard key={model.model || idx} className="flex min-w-0 items-center justify-between gap-2 p-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                        <IconLayersLinked size={16} />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-xs font-semibold text-neutral-900 dark:text-white" title={model.model ?? undefined}>
                          {model.model || 'Mô hình mặc định'}
                        </span>
                        <span className="truncate text-[10px] text-neutral-400 uppercase">
                          {model.provider || 'Provider'}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="truncate text-xs font-bold tabular-nums text-neutral-900 dark:text-white">
                        {model.totalTokens.toLocaleString('vi-VN')}
                      </div>
                      <div className="whitespace-nowrap text-[10px] tabular-nums text-neutral-400">
                        {model.operationCount} cuộc gọi
                      </div>
                    </div>
                  </MobileCard>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
