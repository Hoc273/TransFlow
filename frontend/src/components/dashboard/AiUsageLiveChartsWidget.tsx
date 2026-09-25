import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconCpu,
  IconChartDonut,
  IconChartBar,
  IconActivity,
  IconArrowDownRight,
  IconArrowUpRight,
  IconFolder,
  IconSparkles,
} from '@tabler/icons-react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts'
import { useUsage } from '@/hooks/useUsage'
import { useProjects } from '@/hooks/useProjects'
import { usePermission } from '@/hooks/usePermission'
import { useUiStore } from '@/store/uiStore'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import { assignUsageColors } from '@/lib/usageColors'

const MODEL_PALETTE = ['#7c5cff', '#38bdf8', '#10b981', '#f59e0b', '#ec4899', '#6366f1']

export function AiUsageLiveChartsWidget() {
  const { t } = useTranslation('dashboard')
  const { workspaceId = '' } = useParams()
  const language = useUiStore((s) => s.language)
  const canView = usePermission('dashboard.usage')
  const { data, isLoading, isFetching, isError } = useUsage(workspaceId, { groupBy: 'operation' })
  const { data: projectsData, isLoading: projectsLoading } = useProjects(workspaceId)

  const [activeTab, setActiveTab] = useState<'operation' | 'model'>('operation')

  const totalTokens = data?.totalTokens ?? 0
  const operations = data?.byOperation ?? []
  const models = data?.byModel ?? []

  // Donut chart dataset
  const donutData = useMemo(() => {
    if (activeTab === 'operation') {
      const colors = assignUsageColors(operations.map((op) => op.operation))
      return operations.map((op) => ({
        name: op.operation,
        value: op.totalTokens,
        calls: op.operationCount,
        input: op.inputTokens,
        output: op.outputTokens,
        color: colors.get(op.operation) ?? '#818cf8',
      }))
    }
    return models.map((m, idx) => ({
      name: m.model || m.provider || `Model ${idx + 1}`,
      value: m.totalTokens,
      calls: m.operationCount,
      input: m.inputTokens,
      output: m.outputTokens,
      color: MODEL_PALETTE[idx % MODEL_PALETTE.length],
    }))
  }, [operations, models, activeTab])

  // Bar chart dataset (Input vs Output)
  const barData = useMemo(() => {
    if (activeTab === 'operation') {
      return operations.map((op) => ({
        name: op.operation,
        input: op.inputTokens,
        output: op.outputTokens,
        total: op.totalTokens,
        calls: op.operationCount,
      }))
    }
    return models.map((m, idx) => ({
      name: m.model || m.provider || `Model ${idx + 1}`,
      input: m.inputTokens,
      output: m.outputTokens,
      total: m.totalTokens,
      calls: m.operationCount,
    }))
  }, [operations, models, activeTab])

  if (!canView) return null

  const hasData = totalTokens > 0 || (donutData.length > 0 && donutData.some((d) => d.value > 0))

  return (
    <div className="app-card mb-6 overflow-hidden border border-[var(--color-border)] shadow-md">
      {/* Header bar with Live pulse badge */}
      <div className="app-card-header flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm">
            <IconSparkles size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('live.chartTitle')}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 ring-1 ring-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                {t('live.indicator')}
              </span>
            </div>
          </div>
        </div>

        {/* Tab switch & indicator */}
        <div className="flex items-center gap-2">
          {models.length > 0 && (
            <div className="flex rounded-lg bg-[var(--color-bg-surface-3)] p-0.5 text-xs">
              <button
                type="button"
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition',
                  activeTab === 'operation'
                    ? 'bg-[var(--color-bg-surface)] text-[var(--color-accent)] shadow-xs'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                )}
                onClick={() => setActiveTab('operation')}
              >
                {t('live.byOperation')}
              </button>
              <button
                type="button"
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition',
                  activeTab === 'model'
                    ? 'bg-[var(--color-bg-surface)] text-[var(--color-accent)] shadow-xs'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                )}
                onClick={() => setActiveTab('model')}
              >
                {t('live.byModel')}
              </button>
            </div>
          )}

          {isFetching && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)]">
              <IconActivity size={13} className="animate-spin text-[var(--color-accent)]" />
            </span>
          )}
        </div>
      </div>

      {/* Mini KPI Summary Strip (Integrated from the 4 standalone cards) */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--color-border)]/60 bg-[var(--color-bg-surface-3)]/20 px-5 py-2.5">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-surface-2)]/80 px-2.5 py-1 border border-[var(--color-border)]/60 shadow-2xs">
          <IconSparkles size={13} className="text-[var(--color-accent)]" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('live.totalTokens')}:</span>
          <span className="text-xs font-bold tabular-nums text-[var(--color-text-primary)]">
            {isLoading ? '…' : formatCompactNumber(totalTokens, language)}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-surface-2)]/80 px-2.5 py-1 border border-[var(--color-border)]/60 shadow-2xs">
          <IconArrowDownRight size={13} className="text-[#38bdf8]" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('live.inputTokens')}:</span>
          <span className="text-xs font-bold tabular-nums text-[var(--color-text-primary)]">
            {isLoading ? '…' : formatCompactNumber(data?.totalInputTokens ?? 0, language)}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-surface-2)]/80 px-2.5 py-1 border border-[var(--color-border)]/60 shadow-2xs">
          <IconArrowUpRight size={13} className="text-[#a855f7]" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('live.outputTokens')}:</span>
          <span className="text-xs font-bold tabular-nums text-[var(--color-text-primary)]">
            {isLoading ? '…' : formatCompactNumber(data?.totalOutputTokens ?? 0, language)}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-surface-2)]/80 px-2.5 py-1 border border-[var(--color-border)]/60 shadow-2xs">
          <IconActivity size={13} className="text-emerald-400" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('live.totalCalls')}:</span>
          <span className="text-xs font-bold tabular-nums text-[var(--color-text-primary)]">
            {isLoading ? '…' : formatNumber(data?.operationCount ?? 0, language)}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-surface-2)]/80 px-2.5 py-1 border border-[var(--color-border)]/60 shadow-2xs">
          <IconFolder size={13} className="text-amber-400" />
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('live.totalProjects')}:</span>
          <span className="text-xs font-bold tabular-nums text-[var(--color-text-primary)]">
            {projectsLoading ? '…' : formatNumber(projectsData?.length ?? 0, language)}
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl bg-[var(--color-bg-surface-2)]" />
          <div className="h-64 animate-pulse rounded-xl bg-[var(--color-bg-surface-2)]" />
        </div>
      )}

      {isError && !isLoading && (
        <div className="p-8 text-center text-xs text-[var(--color-error)]">
          {t('widget.usage.loadError')}
        </div>
      )}

      {!isLoading && !isError && !hasData && (
        <div className="p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-bg-surface-2)] text-[var(--color-text-tertiary)]">
            <IconCpu size={24} stroke={1.5} />
          </div>
          <div className="text-sm font-medium text-[var(--color-text-secondary)]">
            {t('live.noData')}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {t('widget.usage.subtitle')}
          </div>
        </div>
      )}

      {!isLoading && !isError && hasData && (
        <div className="grid grid-cols-1 divide-y divide-[var(--color-border)] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {/* Chart 1: Donut breakdown */}
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconChartDonut size={16} className="text-[var(--color-accent)]" />
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {t('live.operationsTitle')}
                </span>
              </div>
              <span className="text-[11px] tabular-nums font-semibold text-[var(--color-text-secondary)]">
                {t('live.totalTokens')}: {formatCompactNumber(totalTokens, language)}
              </span>
            </div>

            <div className="relative h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    innerRadius={58}
                    outerRadius={84}
                    paddingAngle={3}
                    dataKey="value"
                    animationDuration={600}
                  >
                    {donutData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-surface-elevated, #151827)',
                      borderColor: 'var(--color-border, #1f2235)',
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
                    }}
                    itemStyle={{ color: 'var(--color-text-primary)' }}
                    formatter={(val, name, item) => {
                      const num = Number(val) || 0
                      const pct = totalTokens > 0 ? ((num / totalTokens) * 100).toFixed(1) : '0'
                      const calls = (item?.payload as { calls?: number })?.calls ?? 0
                      return [
                        `${formatNumber(num, language)} tokens (${pct}%) · ${formatNumber(calls, language)} calls`,
                        String(name),
                      ]
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Centered Donut label */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-bold tracking-tight text-[var(--color-text-primary)] tabular-nums">
                  {formatCompactNumber(totalTokens, language)}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                  Tokens
                </span>
              </div>
            </div>

            {/* Donut Legend cards */}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {donutData.map((d) => {
                const pct = totalTokens > 0 ? ((d.value / totalTokens) * 100).toFixed(0) : '0'
                return (
                  <div
                    key={d.name}
                    className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/40 p-2 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="truncate text-[11px] font-medium text-[var(--color-text-primary)]">
                        {d.name}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-semibold tabular-nums text-[var(--color-text-primary)]">
                      {formatCompactNumber(d.value, language)}
                      <span className="ml-1 text-[10px] font-normal text-[var(--color-text-tertiary)]">
                        ({pct}%)
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Chart 2: Grouped Bar Chart (Input vs Output) */}
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconChartBar size={16} className="text-[#38bdf8]" />
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {t('live.balanceTitle')}
                </span>
              </div>
              <span className="text-[11px] text-[var(--color-text-tertiary)]">
                {t('live.totalCalls')}: {formatNumber(data?.operationCount ?? 0, language)}
              </span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={barData}
                  margin={{ top: 12, right: 12, left: -16, bottom: 4 }}
                  barGap={4}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                    opacity={0.6}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatCompactNumber(Number(v), language)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-surface-elevated, #151827)',
                      borderColor: 'var(--color-border, #1f2235)',
                      borderRadius: 8,
                      fontSize: 12,
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
                    }}
                    labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600 }}
                    formatter={(val, name) => [
                      formatNumber(Number(val) || 0, language) + ' tokens',
                      name === 'input' ? t('live.inputTokens') : t('live.outputTokens'),
                    ]}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={30}
                    iconType="circle"
                    iconSize={8}
                    formatter={(val) => (
                      <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                        {val === 'input' ? t('live.inputTokens') : t('live.outputTokens')}
                      </span>
                    )}
                  />
                  <Bar
                    dataKey="input"
                    fill="#38bdf8"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                  <Bar
                    dataKey="output"
                    fill="#a855f7"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Quick summary footer */}
            <div className="mt-2 flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/40 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#38bdf8]" />
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  {t('live.inputTokens')}:
                </span>
                <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {formatCompactNumber(data?.totalInputTokens ?? 0, language)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#a855f7]" />
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  {t('live.outputTokens')}:
                </span>
                <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">
                  {formatCompactNumber(data?.totalOutputTokens ?? 0, language)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
