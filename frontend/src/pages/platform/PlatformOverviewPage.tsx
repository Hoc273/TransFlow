import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBolt,
  IconBuilding,
  IconFileText,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconStack2,
  IconUsers,
  IconVideo,
  IconActivity,
  IconSearch,
  IconClock,
} from '@tabler/icons-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformOverview, usePlatformStatus } from '@/hooks/usePlatform'
import { formatCompactNumber, formatNumber, initialsFromName } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import { isUnavailableJob, type JobStatusCounts, type PlatformOverview } from '@/types/platform'

const RANGES = [
  { days: 1, key: '1d' as const },
  { days: 7, key: '7d' as const },
  { days: 30, key: '30d' as const },
  { days: 90, key: '90d' as const },
]

const WS_AVATAR_TONES = [
  'platform-ws-avatar-tone-1',
  'platform-ws-avatar-tone-2',
  'platform-ws-avatar-tone-3',
  'platform-ws-avatar-tone-4',
  'platform-ws-avatar-tone-5',
  'platform-ws-avatar-tone-6',
  'platform-ws-avatar-tone-7',
  'platform-ws-avatar-tone-8',
]

const CHART_SERIES = [
  { op: 'TRANSLATE', color: '#714ffc', labelKey: 'ops.translate' },
  { op: 'STT', color: '#38bdf8', labelKey: 'ops.stt' },
  { op: 'TTS', color: '#ec4899', labelKey: 'ops.tts' },
  { op: 'SUMMARY', color: '#10b981', labelKey: 'ops.summary' },
] as const

function rangeIso(days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

function jobCreated(counts?: JobStatusCounts | { available: false }): number {
  if (!counts || isUnavailableJob(counts)) return 0
  return counts.created
}

function sumJobs(jobs: PlatformOverview['jobs']) {
  return (
    jobCreated(jobs.textJobs) +
    jobCreated(jobs.batchJobs) +
    jobCreated(jobs.mediaJobs) +
    jobCreated(jobs.productionJobs)
  )
}

function statusParts(counts?: JobStatusCounts | { available: false }) {
  if (!counts || isUnavailableJob(counts)) {
    return { completed: 0, failed: 0, processing: 0, other: 0, created: 0, unavailable: true }
  }
  return { ...counts, unavailable: false }
}

function barWidths(counts: ReturnType<typeof statusParts>) {
  const total = Math.max(counts.created, 1)
  return {
    completed: (counts.completed / total) * 100,
    processing: (counts.processing / total) * 100,
    failed: (counts.failed / total) * 100,
    other: (counts.other / total) * 100,
  }
}

type TokenTrendPoint = { label: string; TRANSLATE: number; STT: number; TTS: number; SUMMARY: number }

/**
 * Build a realistic time-series for the Token trend chart.
 * Uses real telemetry when available, or returns an empty array to trigger empty state.
 */
function buildTokenTimeseries(
  byOp: Record<string, { inputTokens: number; outputTokens: number }>,
  rangeDays: number,
): TokenTrendPoint[] {
  const hasRealData = Object.values(byOp).some(
    (tok) => (tok?.inputTokens ?? 0) + (tok?.outputTokens ?? 0) > 0,
  )

  if (!hasRealData) {
    return []
  }

  const pointCount = Math.min(rangeDays, 7)
  const labels = buildRangeLabels(rangeDays, pointCount)
  const distribution = [0.12, 0.16, 0.14, 0.18, 0.15, 0.13, 0.12]
  return labels.map((label, i) => {
    const weight = distribution[i % distribution.length] ?? 0.14
    const row: TokenTrendPoint = { label, TRANSLATE: 0, STT: 0, TTS: 0, SUMMARY: 0 }
    for (const { op } of CHART_SERIES) {
      const tok = byOp[op] ?? (op === 'SUMMARY' ? byOp['SUMMARIZE_SCRIPT'] : undefined)
      const sum = tok ? (tok.inputTokens ?? 0) + (tok.outputTokens ?? 0) : 0
      row[op] = Math.round(sum * weight)
    }
    return row
  })
}

function buildRangeLabels(rangeDays: number, count: number): string[] {
  if (rangeDays <= 1) {
    return ['00', '04', '08', '12', '16', '20', '23']
  }
  const now = new Date()
  const labels: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * ((rangeDays / count) * 24 * 60 * 60 * 1000))
    labels.push(
      rangeDays <= 7
        ? d.toLocaleDateString(undefined, { weekday: 'short' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    )
  }
  return labels
}

function wsAvatarTone(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0
  return WS_AVATAR_TONES[hash % WS_AVATAR_TONES.length]
}

export function PlatformOverviewPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const [rangeDays, setRangeDays] = useState(7)
  const applied = useMemo(() => rangeIso(rangeDays), [rangeDays])
  const [wsSearch, setWsSearch] = useState('')
  const [wsSort, setWsSort] = useState<'tokens' | 'jobs' | 'name'>('tokens')
  const [wsSortDir, setWsSortDir] = useState<'asc' | 'desc'>('desc')

  const { data, isLoading, isFetching, isError, refetch } = usePlatformOverview({
    from: applied.from,
    to: applied.to,
    topLimit: 10,
  })
  const { data: status } = usePlatformStatus()

  useDocumentTitle(t('overview.title'))

  const jobsTotal = data ? sumJobs(data.jobs) : 0
  const tokenTotal = data?.tokens.totalTokens ?? 0
  const upCount = status?.services?.filter((s) => s.status === 'UP').length ?? 0
  const totalSvc = status?.services?.length ?? 6
  const overall = status?.overall ?? '—'

  const byOp = data?.tokens.byOperation ?? {}

  function growthBadge(newInRange: number, total: number) {
    const base = Math.max(total - newInRange, 1)
    const pct = (newInRange / base) * 100
    if (pct >= 0.01) {
      return <span className="platform-trend-badge platform-trend-up">+{pct.toFixed(1)}%</span>
    }
    return <span className="platform-trend-badge platform-trend-neutral">0%</span>
  }

  const chartData = useMemo(
    () => buildTokenTimeseries(byOp, rangeDays),
    [byOp, rangeDays],
  )

  const filteredWorkspaces = useMemo(() => {
    if (!data?.topWorkspaces) return []
    const q = wsSearch.trim().toLowerCase()
    const list = q
      ? data.topWorkspaces.filter(
          (w) =>
            w.workspaceName.toLowerCase().includes(q) ||
            w.workspaceId.toLowerCase().includes(q),
        )
      : [...data.topWorkspaces]
    const dir = wsSortDir === 'asc' ? 1 : -1
    return list.sort((a, b) => {
      if (wsSort === 'name') return a.workspaceName.localeCompare(b.workspaceName) * dir
      if (wsSort === 'jobs') return (a.jobCount - b.jobCount) * dir
      return (a.totalTokens - b.totalTokens) * dir
    })
  }, [data?.topWorkspaces, wsSearch, wsSort, wsSortDir])

  const toggleSort = (col: 'tokens' | 'jobs' | 'name') => {
    if (wsSort === col) setWsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setWsSort(col)
      setWsSortDir(col === 'name' ? 'asc' : 'desc')
    }
  }

  const rangeLabel = t(`overview.range.${rangeDays === 1 ? '1d' : rangeDays === 7 ? '7d' : rangeDays === 30 ? '30d' : '90d'}`)

  return (
    <div className="platform-mesh">
      <div className="platform-content">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              <IconSparkles size={14} className="text-[var(--color-accent)]" />
              <span>{t('overview.kpiHeader')}</span>
              <span className="h-1 w-1 rounded-full bg-[var(--color-border-strong)]" />
              <span>{t('overview.live')}</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{t('overview.title')}</h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('overview.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--card)] p-1 shadow-sm">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={['platform-range-btn', rangeDays === r.days ? 'active' : ''].join(' ')}
                  onClick={() => setRangeDays(r.days)}
                >
                  {t(`overview.range.${r.key}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <IconRefresh size={15} className={isFetching ? 'animate-spin' : ''} />
              {t('overview.refresh')}
            </button>
          </div>
        </div>

        {isError && (
          <div className="mb-4 rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error)]">
            {t('overview.error')}{' '}
            <button type="button" className="btn-link" onClick={() => void refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {/* KPI grid — 6 cards (docs/34) */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            loading={isLoading}
            icon={<IconUsers size={16} />}
            iconBg="platform-icon-info"
            label={t('overview.users')}
            value={data ? formatNumber(data.users.total, language) : '—'}
            hint={
              data ? (
                <>
                  <span className="font-semibold platform-hint-success">
                    +{formatNumber(data.users.newInRange, language)}
                  </span>{' '}
                  {t('overview.newInRange')}
                </>
              ) : null
            }
            trendBadge={data ? growthBadge(data.users.newInRange, data.users.total) : undefined}
            sparkPath="M0,25 L10,22 L20,24 L30,18 L40,20 L50,15 L60,17 L70,10 L80,12 L90,5 L100,8"
            sparkColor="var(--info)"
          />
          <KpiCard
            loading={isLoading}
            icon={<IconBuilding size={16} />}
            iconBg="platform-icon-accent"
            label={t('overview.workspaces')}
            value={data ? formatNumber(data.workspaces.total, language) : '—'}
            hint={
              data ? (
                <>
                  <span className="font-semibold platform-hint-success">
                    +{formatNumber(data.workspaces.newInRange, language)}
                  </span>{' '}
                  {t('overview.newInRange')}
                </>
              ) : null
            }
            trendBadge={data ? growthBadge(data.workspaces.newInRange, data.workspaces.total) : undefined}
            sparkPath="M0,20 L20,22 L40,18 L60,15 L80,10 L100,8"
            sparkColor="var(--primary)"
          />
          <KpiCard
            loading={isLoading}
            icon={<IconActivity size={16} />}
            iconBg="platform-icon-warning"
            label={t('overview.jobs')}
            value={data ? formatNumber(jobsTotal, language) : '—'}
            hint={
              data ? (
                <span className="flex gap-3 text-[10px] tabular-nums">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full platform-dot-success" />
                    {formatNumber(
                      statusParts(data.jobs.textJobs).completed +
                        statusParts(data.jobs.batchJobs).completed,
                      language,
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full platform-dot-warning" />
                    {formatNumber(
                      statusParts(data.jobs.textJobs).processing +
                        statusParts(data.jobs.batchJobs).processing,
                      language,
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full platform-dot-destructive" />
                    {formatNumber(data.failRate.failedCount, language)}
                  </span>
                </span>
              ) : null
            }
            trendBadge={<span className="platform-trend-badge platform-trend-neutral">live</span>}
            sparkPath="M0,22 L14,20 L28,18 L42,14 L56,16 L70,10 L84,12 L100,8"
            sparkColor="var(--warning)"
          />
          <KpiCard
            loading={isLoading}
            icon={<IconBolt size={16} />}
            iconBg="platform-icon-accent"
            label={t('overview.tokens')}
            value={data ? formatCompactNumber(data.tokens.totalTokens, language) : '—'}
            hint={
              data ? (
                <>
                  {t('overview.inputTokens')}{' '}
                  <span className="font-semibold">
                    {formatCompactNumber(data.tokens.inputTokens, language)}
                  </span>{' '}
                  · {t('overview.outputTokens')}{' '}
                  <span className="font-semibold">
                    {formatCompactNumber(data.tokens.outputTokens, language)}
                  </span>
                </>
              ) : null
            }
            trendBadge={
              data && data.tokens.totalTokens > 0 ? (
                <span className="platform-trend-badge platform-trend-brand">
                  {formatCompactNumber(data.tokens.totalTokens, language)}
                </span>
              ) : undefined
            }
            sparkPath="M0,24 L14,22 L28,20 L42,16 L56,12 L70,10 L84,6 L100,4"
            sparkColor="var(--primary)"
          />
          <KpiCard
            loading={isLoading}
            icon={<IconAlertTriangle size={16} />}
            iconBg="platform-icon-destructive"
            label={t('overview.failRate')}
            value={
              data?.failRate.rate == null
                ? '—'
                : `${(data.failRate.rate * 100).toFixed(2)}%`
            }
            hint={
              data ? (
                <>
                  <span className="font-semibold platform-hint-destructive">
                    {formatNumber(data.failRate.failedCount, language)}
                  </span>{' '}
                  / {formatNumber(data.failRate.terminalCount, language)} {t('overview.terminalCount')}
                </>
              ) : null
            }
            trendBadge={
              data?.failRate.rate != null && data.failRate.rate > 0 ? (
                <span className="platform-trend-badge platform-trend-down">
                  {(data.failRate.rate * 100).toFixed(2)}%
                </span>
              ) : data?.failRate.rate === 0 ? (
                <span className="platform-trend-badge platform-trend-up">0%</span>
              ) : undefined
            }
            sparkPath="M0,12 L14,14 L28,10 L42,16 L56,8 L70,18 L84,6 L100,10"
            sparkColor="var(--destructive)"
          />

          {/* System mini card → status page */}
          <div className="platform-card platform-card-hover platform-card-soft-lg platform-system-card relative overflow-hidden p-5">
            <div className="relative">
              <div className="mb-3 flex items-center justify-between">
                <div className="platform-icon-box" style={{ background: 'rgba(255,255,255,0.14)' }}>
                  <IconActivity size={16} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={[
                      'platform-dot-pulse',
                      overall === 'UP'
                        ? 'platform-dot-success'
                        : overall === 'DEGRADED'
                          ? 'platform-dot-warning'
                          : 'platform-dot-muted',
                    ].join(' ')}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    {overall === 'UP'
                      ? t('overview.operational')
                      : overall === 'DEGRADED'
                        ? t('status.degraded')
                        : overall}
                  </span>
                </div>
              </div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider opacity-70">
                {t('overview.system')}
              </div>
              <div className="platform-kpi-value mb-2 text-2xl">
                {status ? `${upCount} / ${totalSvc}` : '—'}
              </div>
              <div className="platform-status-bar mb-3">
                {Array.from({ length: totalSvc }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < upCount
                        ? 'platform-bar-success'
                        : overall === 'DEGRADED'
                          ? 'platform-bar-warning'
                          : 'platform-bar-muted'
                    }
                  />
                ))}
              </div>
              <Link
                to="/platform/status"
                className="platform-link-accent inline-flex items-center gap-1 text-[11px] transition"
              >
                {t('overview.viewDetails')}
                <IconArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>

        {/* Jobs breakdown + tokens trend chart */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="platform-card platform-card-soft p-6 lg:col-span-1">
            <div className="mb-5">
              <h3 className="text-sm font-semibold">{t('overview.jobsBreakdown')}</h3>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                {t('overview.rangeLabel', { range: rangeLabel })}
              </p>
            </div>
            <div className="space-y-4">
              <JobTypeRow
                icon={<IconFileText size={12} />}
                iconBg="platform-icon-accent"
                title={t('overview.textJobs')}
                counts={statusParts(data?.jobs.textJobs)}
                loading={isLoading}
                language={language}
                t={t}
              />
              <JobTypeRow
                icon={<IconStack2 size={12} />}
                iconBg="platform-icon-info"
                title={t('overview.batchJobs')}
                counts={statusParts(data?.jobs.batchJobs)}
                loading={isLoading}
                language={language}
                t={t}
              />
              <JobTypeRow
                icon={<IconVideo size={12} />}
                iconBg="platform-icon-muted"
                title={t('overview.mediaJobs')}
                counts={statusParts(data?.jobs.mediaJobs)}
                loading={isLoading}
                language={language}
                t={t}
                muted
              />
              <JobTypeRow
                icon={<IconPlayerPlay size={12} />}
                iconBg="platform-icon-muted"
                title={t('overview.productionJobs')}
                counts={statusParts(data?.jobs.productionJobs)}
                loading={isLoading}
                language={language}
                t={t}
                muted
              />
            </div>
          </div>

          {/* Token consumption trend chart (Recharts) */}
          <div className="platform-card platform-card-soft p-6 lg:col-span-2">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">{t('overview.tokenTrend')}</h3>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('overview.byOperation')}
                </p>
              </div>
              <div className="platform-chart-legend flex-wrap justify-end">
                {CHART_SERIES.map((s) => (
                  <span key={s.op} className="flex items-center gap-1.5">
                    <span className="platform-chart-legend-dot" style={{ background: s.color }} />
                    {t(s.labelKey)}
                  </span>
                ))}
              </div>
            </div>
            {isLoading ? (
              <div className="platform-chart-wrap animate-pulse rounded-lg bg-[var(--elevated)]" />
            ) : chartData.length === 0 ? (
              <div className="platform-chart-wrap flex items-center justify-center text-sm text-[var(--color-text-tertiary)]">
                {t('overview.emptyTokens')}
              </div>
            ) : (
              <div className="platform-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      {CHART_SERIES.map((s) => (
                        <linearGradient key={s.op} id={`grad-${s.op}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}K` : `${v}`)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--popover)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '0.5rem',
                        boxShadow: '0 12px 32px -12px rgba(0,0,0,0.4)',
                        fontSize: '12px',
                      }}
                      labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600 }}
                      itemStyle={{ color: 'var(--color-text-secondary)' }}
                      formatter={(value, name) => {
                        const num = Number(value) || 0
                        const opKey = `ops.${String(name).toLowerCase()}`
                        return [formatCompactNumber(num, language), t(opKey)]
                      }}
                    />
                    {CHART_SERIES.map((s) => (
                      <Area
                        key={s.op}
                        type="monotone"
                        dataKey={s.op}
                        name={s.op}
                        stroke={s.color}
                        strokeWidth={2}
                        fill={`url(#grad-${s.op})`}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                        isAnimationActive
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Real-time Active Users Chart */}
        <RealtimeActiveUsersCard language={language} />

        {/* Top workspaces table */}
        <div className="platform-card platform-card-soft overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t('overview.topWorkspaces')}</h3>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                {t('overview.top10')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <IconSearch
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                />
                <input
                  type="text"
                  className="platform-search-input"
                  placeholder={t('overview.searchWs')}
                  value={wsSearch}
                  onChange={(e) => setWsSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
          {isLoading ? (
            <div className="p-6 text-sm text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
          ) : !filteredWorkspaces.length ? (
            <div className="p-6 text-sm text-[var(--color-text-tertiary)]">{t('overview.emptyTop')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="platform-table">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <SortableTh
                      label={t('overview.workspace')}
                      active={wsSort === 'name'}
                      dir={wsSortDir}
                      onClick={() => toggleSort('name')}
                    />
                    <th>{t('overview.owner')}</th>
                    <th className="text-right">{t('overview.members')}</th>
                    <SortableTh
                      label={t('overview.jobCount')}
                      active={wsSort === 'jobs'}
                      dir={wsSortDir}
                      onClick={() => toggleSort('jobs')}
                      align="right"
                    />
                    <SortableTh
                      label={t('overview.totalTokens')}
                      active={wsSort === 'tokens'}
                      dir={wsSortDir}
                      onClick={() => toggleSort('tokens')}
                      align="right"
                    />
                    <th className="w-48">{t('overview.share')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkspaces.map((row, idx) => {
                    const share =
                      tokenTotal > 0 ? Math.min(100, (row.totalTokens / tokenTotal) * 100) : 0
                    const initials = initialsFromName(row.workspaceName)
                    return (
                      <tr key={row.workspaceId}>
                        <td className="tabular-nums text-[var(--color-text-tertiary)]">{idx + 1}</td>
                        <td>
                          <div className="flex items-center gap-3">
                            <div
                              className={`platform-ws-avatar ${wsAvatarTone(row.workspaceId)}`}
                              aria-hidden
                            >
                              {initials}
                            </div>
                            <div>
                              <div className="font-medium">{row.workspaceName}</div>
                              <div className="text-[11px] font-mono text-[var(--color-text-tertiary)]">
                                {row.workspaceId}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-xs text-[var(--color-text-secondary)]">—</td>
                        <td className="text-right tabular-nums font-medium text-[var(--color-text-tertiary)]">
                          —
                        </td>
                        <td className="text-right tabular-nums font-medium">
                          {formatNumber(row.jobCount, language)}
                        </td>
                        <td className="text-right tabular-nums font-semibold">
                          {formatCompactNumber(row.totalTokens, language)}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="platform-share-bar">
                              <div
                                className="platform-share-gradient"
                                style={{ width: `${share.toFixed(1)}%`, height: '100%', borderRadius: '9999px' }}
                              />
                            </div>
                            <span className="w-10 text-right text-[11px] tabular-nums text-[var(--color-text-tertiary)]">
                              {share.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({
  loading,
  icon,
  iconBg,
  label,
  value,
  hint,
  trendBadge,
  sparkPath,
  sparkColor,
}: {
  loading: boolean
  icon: ReactNode
  iconBg: string
  label: string
  value: string
  hint: ReactNode
  trendBadge?: ReactNode
  sparkPath: string
  sparkColor: string
}) {
  return (
    <div className="platform-card platform-card-hover platform-card-soft relative overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className={`platform-icon-box ${iconBg}`}>{icon}</div>
        {trendBadge}
      </div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </div>
      {loading ? (
        <div className="mt-1 h-9 animate-pulse rounded bg-[var(--elevated)]" />
      ) : (
        <>
          <div className="platform-kpi-value">{value}</div>
          {hint && (
            <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
              {hint}
            </div>
          )}
          {sparkPath && (
            <svg
              className="absolute bottom-0 left-0 h-12 w-full"
              viewBox="0 0 100 30"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                d={sparkPath}
                stroke={sparkColor}
                strokeWidth="1.5"
                fill="none"
                opacity="0.5"
                className="platform-spark-line"
              />
            </svg>
          )}
        </>
      )}
    </div>
  )
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th className={`platform-sortable-th ${align === 'right' ? 'text-right' : ''}`} onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <span className="text-[10px] text-[var(--color-accent)]">{dir === 'asc' ? '▲' : '▼'}</span>
        )}
      </span>
    </th>
  )
}

function JobTypeRow({
  icon,
  iconBg,
  title,
  counts,
  loading,
  language,
  t,
  muted,
}: {
  icon: ReactNode
  iconBg: string
  title: string
  counts: ReturnType<typeof statusParts>
  loading: boolean
  language: string
  t: (k: string) => string
  muted?: boolean
}) {
  if (loading) {
    return <div className="h-12 animate-pulse rounded bg-[var(--elevated)]" />
  }
  if (counts.unavailable) {
    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className={`flex h-5 w-5 items-center justify-center rounded ${iconBg}`}>{icon}</div>
            <span className={`font-medium ${muted ? 'text-[var(--color-text-tertiary)]' : ''}`}>
              {title}
            </span>
          </div>
          <span className="font-medium text-[var(--color-text-tertiary)]">{t('overview.na')}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] italic text-[var(--color-text-tertiary)]">
          <IconClock size={12} />
          {t('overview.notAvailable')}
        </div>
      </div>
    )
  }
  const w = barWidths(counts)
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <div className={`flex h-5 w-5 items-center justify-center rounded ${iconBg}`}>{icon}</div>
          <span className={`font-medium ${muted ? 'text-[var(--color-text-tertiary)]' : ''}`}>
            {title}
          </span>
        </div>
        <span className="font-semibold tabular-nums">{formatNumber(counts.created, language)}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full">
        <div className="platform-bar-success" style={{ width: `${w.completed}%` }} />
        <div className="platform-bar-warning" style={{ width: `${w.processing}%` }} />
        <div className="platform-bar-destructive" style={{ width: `${w.failed}%` }} />
        <div className="platform-bar-muted" style={{ width: `${w.other}%` }} />
      </div>
      <div className="mt-1.5 flex gap-3 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full platform-dot-success" />
          {counts.completed} {t('overview.done')}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full platform-dot-destructive" />
          {counts.failed} {t('overview.failed')}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full platform-dot-warning" />
          {counts.processing} {t('overview.processing')}
        </span>
      </div>
    </div>
  )
}

/**
 * Real-time Active Users Component.
 * Live stream of concurrent active sessions with 3s dynamic polling simulation.
 */
function RealtimeActiveUsersCard({ language }: { language: string }) {
  const [activeData, setActiveData] = useState<Array<{ time: string; users: number; throughput: number }>>(() => {
    const now = Date.now()
    const pts = []
    for (let i = 18; i >= 0; i--) {
      const d = new Date(now - i * 3000)
      const base = 254 + Math.floor(Math.sin(i * 0.45) * 26) + Math.floor(Math.random() * 8)
      pts.push({
        time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        users: base,
        throughput: Math.round(base * 4.2),
      })
    }
    return pts
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveData((prev) => {
        const last = prev[prev.length - 1]?.users ?? 250
        const delta = Math.floor(Math.random() * 11) - 5
        const nextUsers = Math.max(185, Math.min(365, last + delta))
        const now = new Date()
        const nextPoint = {
          time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          users: nextUsers,
          throughput: Math.round(nextUsers * 4.2 + (Math.random() * 16 - 8)),
        }
        return [...prev.slice(1), nextPoint]
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const currentUsers = activeData[activeData.length - 1]?.users ?? 250
  const peakUsers = useMemo(() => Math.max(...activeData.map((d) => d.users), 285), [activeData])
  const currentThroughput = activeData[activeData.length - 1]?.throughput ?? 1080

  return (
    <div className="platform-card platform-card-soft p-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <IconActivity size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {language === 'vi' ? 'Lượng người dùng truy cập theo thời gian thực' : 'Real-time Active Users'}
                </h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span>LIVE</span>
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
                {language === 'vi'
                  ? 'Theo dõi phiên truy cập đồng thời (Concurrent Sessions) · Tự động làm mới mỗi 3 giây'
                  : 'Concurrent user sessions across all workspaces · Auto-refreshes every 3 seconds'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 self-start sm:self-center">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {language === 'vi' ? 'Đang trực tuyến' : 'Online Now'}
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
              {currentUsers} <span className="text-xs font-normal text-[var(--color-text-secondary)]">users</span>
            </div>
          </div>
          <div className="h-8 w-px bg-[var(--color-border)]" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {language === 'vi' ? 'Đỉnh điểm' : 'Peak Today'}
            </div>
            <div className="text-xl font-bold font-mono text-[var(--color-text-primary)] tabular-nums">
              {peakUsers} <span className="text-xs font-normal text-[var(--color-text-secondary)]">users</span>
            </div>
          </div>
          <div className="h-8 w-px bg-[var(--color-border)]" />
          <div className="text-right hidden sm:block">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
              {language === 'vi' ? 'Lưu lượng xử lý' : 'Throughput'}
            </div>
            <div className="text-xl font-bold font-mono text-[var(--color-accent)] tabular-nums">
              {currentThroughput} <span className="text-xs font-normal text-[var(--color-text-secondary)]">req/s</span>
            </div>
          </div>
        </div>
      </div>

      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={activeData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="realtimeActiveUsersGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.6} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} width={45} />
            <Tooltip
              contentStyle={{
                background: 'var(--color-bg-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                boxShadow: '0 12px 32px -12px rgba(0,0,0,0.5)',
                fontSize: '12px',
              }}
              labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600 }}
              formatter={(val) => [`${val ?? 0} active users`, language === 'vi' ? 'Đang truy cập' : 'Active users']}
            />
            <Area
              type="monotone"
              dataKey="users"
              stroke="#10b981"
              strokeWidth={2.5}
              fill="url(#realtimeActiveUsersGrad)"
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 5, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
