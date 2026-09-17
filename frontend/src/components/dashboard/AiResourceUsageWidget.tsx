import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { useUsage, embedTokensFromUsage } from '@/hooks/useUsage'
import { usePermission } from '@/hooks/usePermission'
import { useUiStore } from '@/store/uiStore'
import { formatCompactNumber } from '@/lib/format'
import { ApiError } from '@/types/api'

import type { ReactNode } from 'react'
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconCoins,
  IconSparkles,
} from '@tabler/icons-react'

type UsageCard = {
  key: string
  label: string
  value: string
  sub: string
  icon: ReactNode
  color: string
  sparkPath: string
  isCost?: boolean
  loading?: boolean
}

/**
 * AI Resource Usage stats — GET /workspaces/{ws}/dashboard/usage (PM/Admin).
 * Cost is always "Coming soon" (Q-DASH1).
 */
export function AiResourceUsageWidget() {
  const { t } = useTranslation('dashboard')
  const { workspaceId } = useParams()
  const language = useUiStore((s) => s.language)
  const canView = usePermission('dashboard.usage')
  const { data, isLoading, isError, error, isFetching } = useUsage(workspaceId)

  if (!canView) {
    return (
      <div className="mb-4 rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-2)] px-3 py-3 text-xs text-[var(--color-text-tertiary)]">
        {t('widget.usage.restricted')}
      </div>
    )
  }

  const embed = embedTokensFromUsage(data?.byOperation)
  const empty = !isLoading && !isError && (data?.totalTokens ?? 0) === 0 && (data?.operationCount ?? 0) === 0

  const cards: UsageCard[] = [
    {
      key: 'input',
      label: t('widget.usage.inputTokens'),
      value: isLoading ? '…' : formatCompactNumber(data?.totalInputTokens ?? 0, language),
      sub: empty ? t('widget.usage.empty') : t('widget.usage.subtitle'),
      icon: <IconArrowDownRight size={16} />,
      color: '#38bdf8',
      sparkPath: 'M0,18 Q20,22 40,14 T80,10 T100,6',
      loading: isLoading,
    },
    {
      key: 'output',
      label: t('widget.usage.outputTokens'),
      value: isLoading ? '…' : formatCompactNumber(data?.totalOutputTokens ?? 0, language),
      sub: empty ? t('widget.usage.empty') : t('widget.usage.subtitle'),
      icon: <IconArrowUpRight size={16} />,
      color: '#a855f7',
      sparkPath: 'M0,20 Q25,12 50,16 T85,8 T100,4',
      loading: isLoading,
    },
    {
      key: 'embed',
      label: t('widget.usage.embedTokens'),
      value: isLoading ? '…' : formatCompactNumber(embed, language),
      sub: empty ? t('widget.usage.empty') : t('widget.usage.subtitle'),
      icon: <IconSparkles size={16} />,
      color: '#f59e0b',
      sparkPath: 'M0,16 Q30,22 60,12 T90,14 T100,8',
      loading: isLoading,
    },
    {
      key: 'cost',
      label: t('widget.usage.cost'),
      value: data?.cost || t('widget.usage.comingSoon'),
      sub: 'Q-DASH1',
      icon: <IconCoins size={16} />,
      color: '#10b981',
      sparkPath: 'M0,22 Q20,18 40,20 T70,12 T100,10',
      isCost: true,
    },
  ]

  return (
    <div className="mb-6">
      {isError && (
        <div className="mb-3 rounded-md border border-[rgba(239,68,68,0.25)] bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error)]">
          {error instanceof ApiError ? error.message : t('widget.usage.loadError')}
        </div>
      )}
      <div className="dashboard-stats" aria-busy={isLoading || isFetching}>
        {cards.map((card) => (
          <div key={card.key} className="app-card stat-card relative overflow-hidden group hover:border-[var(--color-accent)]/50 transition">
            <div className="flex items-center justify-between">
              <div className="stat-label">{card.label}</div>
              <div
                className="flex h-6 w-6 items-center justify-center rounded-md text-white/90 shadow-xs"
                style={{ backgroundColor: `${card.color}20`, color: card.color }}
              >
                {card.icon}
              </div>
            </div>
            <div
              className="stat-value tabular-nums mt-2"
              style={
                card.isCost
                  ? { fontSize: 16, color: 'var(--color-text-tertiary)', fontWeight: 500 }
                  : undefined
              }
            >
              {card.value}
            </div>
            <div className="stat-sub flex items-center justify-between">
              <div>{card.isCost ? <span className="phase-badge">{card.sub}</span> : card.sub}</div>
            </div>

            {/* Mini subtle sparkline at bottom */}
            <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-6 opacity-30 group-hover:opacity-60 transition">
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-full w-full">
                <path
                  d={card.sparkPath}
                  fill="none"
                  stroke={card.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
