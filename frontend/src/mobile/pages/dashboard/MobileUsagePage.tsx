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
import { formatNumber } from '@/lib/format'
import { useTranslation } from 'react-i18next'

const OPERATION_LABELS: Record<string, { labelKey: string; color: string }> = {
  TRANSLATE: { labelKey: 'mobile:usage.opTranslate', color: 'bg-primary' },
  QA: { labelKey: 'mobile:usage.opQa', color: 'bg-sky-500' },
  EMBED: { labelKey: 'mobile:usage.opEmbed', color: 'bg-amber-500' },
  SUMMARY: { labelKey: 'mobile:usage.opSummary', color: 'bg-emerald-500' },
}

export function MobileUsagePage() {
  const { t, i18n } = useTranslation('mobile')
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
          aria-label={t('mobile:usage.back')}
        >
          <IconArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">{t('mobile:usage.title')}</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
            {t('mobile:usage.subtitle')}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <MobileCard className="animate-pulse py-8 text-center text-xs text-neutral-400">
            {t('mobile:usage.loading')}
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
          {t('mobile:usage.loadFailed')}
        </MobileCard>
      ) : (
        <>
          {/* Main Total Tokens Card */}
          <MobileCard className="flex min-w-0 flex-col gap-2 p-4 bg-gradient-to-br from-white to-primary/5 dark:from-neutral-900 dark:to-primary/10">
            <div className="flex min-w-0 items-center justify-between gap-2 text-neutral-500 dark:text-neutral-400">
              <span className="truncate text-xs font-semibold uppercase tracking-wider">{t('mobile:usage.totalTokens')}</span>
              <IconSparkles size={20} className="shrink-0 text-primary" />
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-3xl font-extrabold tabular-nums text-neutral-900 dark:text-white">
                {formatNumber(totalTokens, i18n.language)}
              </span>
              <span className="shrink-0 text-xs font-medium text-neutral-500">{t('mobile:usage.tokensUnit')}</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1 pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs">
              <span className="text-neutral-500 dark:text-neutral-400">{t('mobile:usage.totalCalls')}</span>
              <span className="font-bold text-neutral-900 dark:text-white">
                {formatNumber(usage?.operationCount ?? 0, i18n.language)}
              </span>
            </div>
          </MobileCard>

          {/* Detailed Token Breakdown Cards */}
          <div className="grid min-w-0 grid-cols-2 gap-2.5">
            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">{t('mobile:usage.inputTokens')}</span>
                <IconArrowDownRight size={18} className="shrink-0 text-sky-500" />
              </div>
              <span className="truncate text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
                {formatNumber(usage?.totalInputTokens ?? 0, i18n.language)}
              </span>
              <span className="truncate text-[10px] text-neutral-400">{t('mobile:usage.inputHint')}</span>
            </MobileCard>

            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">{t('mobile:usage.outputTokens')}</span>
                <IconArrowUpRight size={18} className="shrink-0 text-purple-500" />
              </div>
              <span className="truncate text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
                {formatNumber(usage?.totalOutputTokens ?? 0, i18n.language)}
              </span>
              <span className="truncate text-[10px] text-neutral-400">{t('mobile:usage.outputHint')}</span>
            </MobileCard>

            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">{t('mobile:usage.estimatedCost')}</span>
                <IconCoin size={18} className="shrink-0 text-amber-500" />
              </div>
              <span className="truncate text-base font-bold tabular-nums text-neutral-900 dark:text-white" title={usage?.cost ?? undefined}>
                {usage?.cost || t('mobile:usage.comingSoon')}
              </span>
              <span className="truncate text-[10px] text-neutral-400">{t('mobile:usage.costHint')}</span>
            </MobileCard>

            <MobileCard className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center justify-between gap-1 text-neutral-500 dark:text-neutral-400">
                <span className="truncate text-xs font-medium">{t('mobile:usage.calls')}</span>
                <IconActivity size={18} className="shrink-0 text-emerald-500" />
              </div>
              <span className="truncate text-xl font-bold tabular-nums text-neutral-900 dark:text-white">
                {formatNumber(usage?.operationCount ?? 0, i18n.language)}
              </span>
              <span className="truncate text-[10px] text-neutral-400">{t('mobile:usage.callsHint')}</span>
            </MobileCard>
          </div>

          {/* Breakdown By Operation */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {t('mobile:usage.byOperation')}
            </h2>
            {usage?.byOperation && usage.byOperation.length > 0 ? (
              <div className="space-y-2.5">
                {usage.byOperation.map((op) => {
                  const percent = totalTokens > 0 ? Math.round((op.totalTokens / totalTokens) * 100) : 0
                  const known = OPERATION_LABELS[op.operation.toUpperCase()]
                  const opMeta = known
                    ? { label: t(known.labelKey), color: known.color }
                    : { label: op.operation, color: 'bg-neutral-500' }

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
                          {t('mobile:usage.total')} <strong className="tabular-nums text-neutral-800 dark:text-neutral-200">{formatNumber(op.totalTokens, i18n.language)}</strong>
                        </span>
                        <span className="truncate tabular-nums">
                          In: {formatNumber(op.inputTokens, i18n.language)} | Out: {formatNumber(op.outputTokens, i18n.language)}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {t('mobile:usage.opCalls', { count: op.operationCount })}
                        </span>
                      </div>
                    </MobileCard>
                  )
                })}
              </div>
            ) : (
              <MobileCard className="py-6 text-center text-xs text-neutral-400">
                {t('mobile:usage.noOperationData')}
              </MobileCard>
            )}
          </div>

          {/* Breakdown By Model */}
          {usage?.byModel && usage.byModel.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {t('mobile:usage.byModel')}
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
                          {model.model || t('mobile:usage.defaultModel')}
                        </span>
                        <span className="truncate text-[10px] text-neutral-400 uppercase">
                          {model.provider || 'Provider'}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="truncate text-xs font-bold tabular-nums text-neutral-900 dark:text-white">
                        {formatNumber(model.totalTokens, i18n.language)}
                      </div>
                      <div className="whitespace-nowrap text-[10px] tabular-nums text-neutral-400">
                        {t('mobile:usage.modelCalls', { count: model.operationCount })}
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
