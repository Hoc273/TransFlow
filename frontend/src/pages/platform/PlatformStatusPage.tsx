import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconBox,
  IconCheck,
  IconClock,
  IconCloud,
  IconDatabase,
  IconGauge,
  IconMovie,
  IconRefresh,
  IconSearch,
  IconServer,
  IconSparkles,
  IconStack2,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePlatformStatus } from '@/hooks/usePlatform'
import { formatDateTime } from '@/lib/format'
import { useUiStore } from '@/store/uiStore'
import type { ServiceStatus } from '@/types/platform'

type ServiceMeta = {
  icon: typeof IconServer
  categoryVi: string
  categoryEn: string
  accentColor: string
  accentBg: string
}

const SERVICE_CONFIG: Record<string, ServiceMeta> = {
  db: {
    icon: IconDatabase,
    categoryVi: 'Cơ sở dữ liệu chính',
    categoryEn: 'Primary Database',
    accentColor: '#3b82f6',
    accentBg: 'rgba(59, 130, 246, 0.12)',
  },
  postgresql: {
    icon: IconDatabase,
    categoryVi: 'Cơ sở dữ liệu chính',
    categoryEn: 'Primary Database',
    accentColor: '#3b82f6',
    accentBg: 'rgba(59, 130, 246, 0.12)',
  },
  redis: {
    icon: IconBolt,
    categoryVi: 'Bộ nhớ đệm & Hàng đợi',
    categoryEn: 'Cache & Message Queue',
    accentColor: '#ef4444',
    accentBg: 'rgba(239, 68, 68, 0.12)',
  },
  worker: {
    icon: IconVideo,
    categoryVi: 'Worker xử lý video / âm thanh',
    categoryEn: 'Media Processing Cluster',
    accentColor: '#8b5cf6',
    accentBg: 'rgba(139, 92, 246, 0.12)',
  },
  comp_worker: {
    icon: IconMovie,
    categoryVi: 'Worker dựng hình & Render GPU',
    categoryEn: 'Composition & GPU Render',
    accentColor: '#ec4899',
    accentBg: 'rgba(236, 72, 153, 0.12)',
  },
  storage: {
    icon: IconCloud,
    categoryVi: 'Lưu trữ tệp & Object Store',
    categoryEn: 'Object & File Storage',
    accentColor: '#06b6d4',
    accentBg: 'rgba(6, 182, 212, 0.12)',
  },
  minio: {
    icon: IconBox,
    categoryVi: 'Lưu trữ tệp & Object Store',
    categoryEn: 'Object & File Storage',
    accentColor: '#06b6d4',
    accentBg: 'rgba(6, 182, 212, 0.12)',
  },
  ai_gateway: {
    icon: IconSparkles,
    categoryVi: 'Cổng điều phối AI Inference',
    categoryEn: 'AI Inference Gateway',
    accentColor: '#10b981',
    accentBg: 'rgba(16, 185, 129, 0.12)',
  },
  rabbitmq: {
    icon: IconActivity,
    categoryVi: 'Hàng đợi tin nhắn',
    categoryEn: 'Message Broker',
    accentColor: '#f97316',
    accentBg: 'rgba(249, 115, 22, 0.12)',
  },
  fastapi: {
    icon: IconStack2,
    categoryVi: 'Dịch vụ API backend',
    categoryEn: 'Backend API Service',
    accentColor: '#059669',
    accentBg: 'rgba(5, 150, 105, 0.12)',
  },
  spring_boot: {
    icon: IconServer,
    categoryVi: 'Dịch vụ Core platform',
    categoryEn: 'Core Platform Service',
    accentColor: '#6366f1',
    accentBg: 'rgba(99, 102, 241, 0.12)',
  },
}

const DEFAULT_SERVICE_META: ServiceMeta = {
  icon: IconServer,
  categoryVi: 'Dịch vụ hệ thống',
  categoryEn: 'System Service',
  accentColor: '#6366f1',
  accentBg: 'rgba(99, 102, 241, 0.12)',
}

export function PlatformStatusPage() {
  const { t } = useTranslation('platform')
  const language = useUiStore((s) => s.language)
  const { data, isLoading, isFetching, isError, refetch } = usePlatformStatus()

  const [autoRefresh, setAutoRefresh] = useState(true)
  const [countdown, setCountdown] = useState(30)
  const [filter, setFilter] = useState<'all' | 'up' | 'issues'>('all')
  const [search, setSearch] = useState('')

  useDocumentTitle(t('status.title'))

  // Auto refresh timer
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void refetch()
          return 30
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [autoRefresh, refetch])

  const handleManualRefresh = () => {
    setCountdown(30)
    void refetch()
  }

  const services = useMemo(() => data?.services ?? [], [data?.services])
  const total = services.length || 6
  const upCount = services.filter((s) => s.status === 'UP').length
  const issueCount = total - upCount
  const overall = data?.overall ?? (issueCount === 0 ? 'UP' : 'DEGRADED')
  const isAllUp = overall === 'UP' && upCount === total

  // Performance calculations
  const { avgLatency, fastestService } = useMemo(() => {
    const latencies = services
      .filter((s) => typeof s.latencyMs === 'number')
      .map((s) => s.latencyMs as number)

    const avg = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null

    let fastest: ServiceStatus | null = null
    for (const svc of services) {
      if (typeof svc.latencyMs === 'number') {
        if (!fastest || (fastest.latencyMs != null && svc.latencyMs < fastest.latencyMs)) {
          fastest = svc
        }
      }
    }
    return { avgLatency: avg, fastestService: fastest }
  }, [services])

  // Filtered services
  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return services.filter((svc) => {
      if (filter === 'up' && svc.status !== 'UP') return false
      if (filter === 'issues' && svc.status === 'UP') return false
      if (q) {
        const hay = [svc.name, svc.id, svc.message ?? ''].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [services, filter, search])

  return (
    <div className="platform-content">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-semibold uppercase tracking-wider text-emerald-500">Live Health</span>
            <span className="h-1 w-1 rounded-full bg-[var(--color-border-strong)]" />
            <span>{total} core services</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t('status.title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t('status.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:border-[var(--color-border-strong)]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => {
                setAutoRefresh(e.target.checked)
                if (e.target.checked) setCountdown(30)
              }}
              className="rounded border-[var(--color-border-strong)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            <span className="tabular-nums">
              {autoRefresh ? `${t('status.autoRefresh')} (${countdown}s)` : t('status.autoRefresh')}
            </span>
          </label>

          <button
            type="button"
            className="btn-secondary"
            disabled={isFetching}
            onClick={handleManualRefresh}
          >
            <IconRefresh size={15} className={isFetching ? 'animate-spin' : ''} />
            {t('status.refresh')}
          </button>
        </div>
      </div>

      {isError && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-error)] bg-[var(--color-error-bg)] p-4 text-sm text-[var(--color-error)]">
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={18} className="shrink-0" />
            <span>{t('status.error')}</span>
          </div>
          <button
            type="button"
            className="btn-link font-semibold underline underline-offset-2"
            onClick={handleManualRefresh}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Main System Health Banner */}
      <div
        className={`platform-card relative mb-8 overflow-hidden rounded-2xl border p-6 transition-all ${
          isAllUp
            ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] via-transparent to-transparent shadow-lg shadow-emerald-500/[0.03]'
            : 'border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] via-transparent to-transparent shadow-lg shadow-amber-500/[0.03]'
        }`}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <div className="mb-2.5 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isAllUp
                    ? 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isAllUp ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'
                  }`}
                />
                {isAllUp ? 'UP · 100% OPERATIONAL' : `${overall} · ISSUES DETECTED`}
              </span>
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-3xl">
              {isAllUp ? t('status.allOperational') : t('status.issuesDetected')}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)] leading-relaxed">
              {isAllUp
                ? t('status.allOperationalSub', { count: total })
                : t('status.issuesDetectedSub', { count: issueCount })}
            </p>
          </div>

          {/* Quick Metrics Cluster */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-auto">
            {/* Health / Ratio */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--card)] p-3.5 shadow-sm">
              <div className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('status.servicesHealthy')}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-xl font-bold tabular-nums text-emerald-500">{upCount}</span>
                <span className="text-xs text-[var(--color-text-tertiary)]">/ {total}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-surface-2)]">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${(upCount / total) * 100}%` }}
                />
              </div>
            </div>

            {/* Average Latency */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--card)] p-3.5 shadow-sm">
              <div className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('status.avgLatency')}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
                  {avgLatency != null ? avgLatency : '—'}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">{t('status.ms')}</span>
              </div>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-cyan-500">
                <IconGauge size={12} />
                <span>{avgLatency && avgLatency < 50 ? t('status.speedGood') : t('status.speedModerate')}</span>
              </div>
            </div>

            {/* Fastest Service */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--card)] p-3.5 shadow-sm">
              <div className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('status.fastestService')}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1 truncate">
                <span className="text-xl font-bold tabular-nums text-emerald-500">
                  {fastestService?.latencyMs != null ? `${fastestService.latencyMs} ms` : '—'}
                </span>
              </div>
              <div className="mt-2 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]" title={fastestService?.name}>
                {fastestService?.id || '—'}
              </div>
            </div>

            {/* Last Checked */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--card)] p-3.5 shadow-sm">
              <div className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('status.checkedAt')}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                <IconClock size={15} className="text-[var(--color-text-tertiary)]" />
                <span className="truncate">{data?.checkedAt ? formatRelativeTime(data.checkedAt, language) : '—'}</span>
              </div>
              <div className="mt-2 truncate text-[10px] text-[var(--color-text-tertiary)]">
                {data?.checkedAt ? formatDateTime(data.checkedAt, language) : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        {/* Filter Chips */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`platform-filter-chip ${filter === 'all' ? 'active' : ''}`}
          >
            {t('status.filterAll')}
            <span className="ml-1 rounded-full bg-[var(--color-bg-surface-2)] px-1.5 py-0.2 text-[10px] tabular-nums text-[var(--color-text-secondary)]">
              {total}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('up')}
            className={`platform-filter-chip ${filter === 'up' ? 'active' : ''}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t('status.filterUp')}
            <span className="ml-1 rounded-full bg-[var(--color-bg-surface-2)] px-1.5 py-0.2 text-[10px] tabular-nums text-[var(--color-text-secondary)]">
              {upCount}
            </span>
          </button>
          {issueCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter('issues')}
              className={`platform-filter-chip ${filter === 'issues' ? 'active' : ''}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {t('status.filterIssues')}
              <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] tabular-nums text-amber-500">
                {issueCount}
              </span>
            </button>
          )}
        </div>

        {/* Search filter input with fixed left padding */}
        <div className="relative min-w-[240px] max-w-xs flex-1">
          <IconSearch
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            className="input w-full !pl-9 pr-8 text-xs"
            placeholder={t('status.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Filter services"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              title={t('common.clear', 'Xoá')}
              aria-label="Clear search"
            >
              <IconX size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="platform-card h-48 animate-pulse rounded-xl p-5" />
            ))
          : filteredServices.length === 0 ? (
              <div className="col-span-full platform-card flex flex-col items-center justify-center p-12 text-center">
                <IconSearch size={32} className="text-[var(--color-text-tertiary)] mb-2" />
                <div className="font-medium text-sm text-[var(--color-text-primary)]">
                  {language === 'vi' ? 'Không tìm thấy service phù hợp' : 'No matching services found'}
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  {language === 'vi' ? 'Hãy thử xoá bộ lọc tìm kiếm' : 'Try clearing your search query'}
                </p>
                <button
                  type="button"
                  className="btn-secondary mt-4 text-xs"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                  }}
                >
                  {language === 'vi' ? 'Xoá bộ lọc' : 'Reset filters'}
                </button>
              </div>
            ) : (
              filteredServices.map((svc) => (
                <ServiceCard key={svc.id} svc={svc} language={language} t={t} />
              ))
            )}
      </div>
    </div>
  )
}

function ServiceCard({
  svc,
  language,
  t,
}: {
  svc: ServiceStatus
  language: string
  t: (k: string) => string
}) {
  const meta = SERVICE_CONFIG[svc.id] ?? DEFAULT_SERVICE_META
  const Icon = meta.icon
  const category = language === 'vi' ? meta.categoryVi : meta.categoryEn
  const latencyGrade = getLatencyGrade(svc.latencyMs, t)
  const isUp = svc.status === 'UP'

  // Normalize latency progress percentage (scale 0-100ms)
  const latencyPercent = svc.latencyMs != null ? Math.min(100, Math.max(5, (svc.latencyMs / 100) * 100)) : 0

  return (
    <div className="platform-card platform-card-hover group relative flex flex-col justify-between overflow-hidden rounded-xl border p-5 transition-all">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105"
              style={{ background: meta.accentBg, color: meta.accentColor }}
            >
              <Icon size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]" title={svc.name}>
                {svc.name}
              </h3>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                <span className="font-mono text-[11px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-surface-2)] px-1.5 py-0.5 rounded">
                  {svc.id}
                </span>
                <span className="truncate text-[11px] text-[var(--color-text-tertiary)]">{category}</span>
              </div>
            </div>
          </div>

          <ServiceStatusBadge status={svc.status} />
        </div>

        {/* Latency row with gauge bar */}
        <div className="mt-4 rounded-lg bg-[var(--color-bg-surface-2)]/60 p-3 border border-[var(--color-border)]">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[11px] text-[var(--color-text-secondary)] font-medium">
              {t('status.latency')}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-bold tabular-nums text-[var(--color-text-primary)]">
                {svc.latencyMs == null ? t('status.noMessage') : `${svc.latencyMs} ${t('status.ms')}`}
              </span>
              {latencyGrade && (
                <span className={`rounded px-1.5 py-0.2 text-[10px] font-semibold border ${latencyGrade.color}`}>
                  {latencyGrade.label}
                </span>
              )}
            </div>
          </div>

          {/* Mini progress bar */}
          {svc.latencyMs != null && latencyGrade && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${latencyGrade.barColor}`}
                style={{ width: `${latencyPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Operational Message */}
        {svc.message && (
          <div className="mt-3">
            {isUp ? (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/40 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                <IconCheck size={14} className="shrink-0 text-emerald-500" />
                <span className="truncate text-[11px] font-medium" title={svc.message}>
                  {svc.message}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                <IconAlertTriangle size={14} className="shrink-0 text-red-500" />
                <span className="truncate text-[11px] font-medium" title={svc.message}>
                  {svc.message}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ServiceStatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase() ?? ''
  if (s === 'UP') {
    return (
      <span className="platform-pill platform-pill-success inline-flex items-center gap-1.5 font-semibold">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        UP
      </span>
    )
  }
  if (s === 'DEGRADED') {
    return (
      <span className="platform-pill platform-pill-warn inline-flex items-center gap-1.5 font-semibold">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        DEGRADED
      </span>
    )
  }
  return (
    <span className="platform-pill platform-pill-destructive inline-flex items-center gap-1.5 font-semibold">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      {status}
    </span>
  )
}

function getLatencyGrade(latencyMs: number | null, t: (k: string) => string) {
  if (latencyMs == null) return null
  if (latencyMs < 20) {
    return {
      label: t('status.speedFast'),
      color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
      barColor: 'bg-emerald-500',
    }
  }
  if (latencyMs < 50) {
    return {
      label: t('status.speedGood'),
      color: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/20',
      barColor: 'bg-cyan-500',
    }
  }
  if (latencyMs < 100) {
    return {
      label: t('status.speedModerate'),
      color: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
      barColor: 'bg-amber-500',
    }
  }
  return {
    label: t('status.speedSlow'),
    color: 'text-red-500 bg-red-500/10 border-red-500/20',
    barColor: 'bg-red-500',
  }
}

function formatRelativeTime(dateStr: string, language: string) {
  try {
    const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000))
    if (diff < 15) return language === 'vi' ? 'Vừa xong' : 'Just now'
    if (diff < 60) return language === 'vi' ? `${diff} giây trước` : `${diff}s ago`
    const mins = Math.floor(diff / 60)
    if (mins < 60) return language === 'vi' ? `${mins} phút trước` : `${mins}m ago`
    return formatDateTime(dateStr, language)
  } catch {
    return dateStr
  }
}
