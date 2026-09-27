import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconLoader2, IconTypography } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  matchAssignedPreset,
  useAssignSubtitleStyle,
  useJobSubtitleStyle,
  useSubtitleStyleDetails,
  useSubtitleStylePresets,
} from '@/hooks/useSubtitleStyle'
import { cn } from '@/lib/cn'
import { ApiError } from '@/types/api'
import { isSubtitleStyleErrorCode, type SubtitleStylePreset } from '@/types/subtitleStyle'

type Props = {
  jobId: string
  canEdit: boolean
  /**
   * §1.8.2 redesign — compact picker for the Finish & Render workbench: a
   * collapsed group with chips instead of the full card grid. The default
   * (false) keeps the historical card rendering.
   */
  compact?: boolean
}

/**
 * i18n key for an assign failure, resolved from the machine-readable
 * `ApiError.code` only — server messages are never parsed or displayed.
 */
export function subtitleStyleErrorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : ''
  return isSubtitleStyleErrorCode(code)
    ? `media:subtitleStyle.error.${code}`
    : 'common:error.generic'
}

/**
 * Runs one assign attempt under a single-flight guard.
 *
 * Returns the error i18n key on failure, or null on success. The guard is what
 * prevents double-submit: a second call while `busy` is a no-op, which covers
 * repeat clicks landing before React re-renders the button as `disabled`.
 */
export async function runSubtitleStyleAssign(
  key: string,
  deps: {
    busy: boolean
    canEdit: boolean
    assign: (key: string) => Promise<unknown>
    onPending: (key: string | null) => void
    onNotice: (key: string | null) => void
  },
): Promise<string | null> {
  if (deps.busy || !deps.canEdit) return null
  deps.onPending(key)
  deps.onNotice(null)
  try {
    await deps.assign(key)
    return null
  } catch (error) {
    const messageKey = subtitleStyleErrorKey(error)
    deps.onNotice(messageKey)
    return messageKey
  } finally {
    deps.onPending(null)
  }
}

/**
 * B1.2 subtitle style selection (docs/93 §4.6.11). Presets are addressed by
 * stable `assetKey` — asset UUIDs are never rendered or sent.
 */
export function SubtitleStylePanel({ jobId, canEdit, compact = false }: Props) {
  const { t } = useTranslation(['media', 'common'])
  const presetsQuery = useSubtitleStylePresets()
  const currentQuery = useJobSubtitleStyle(jobId)
  const details = useSubtitleStyleDetails(presetsQuery.data)
  const assign = useAssignSubtitleStyle(jobId)

  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const presets = presetsQuery.data ?? []
  const assigned = matchAssignedPreset(currentQuery.data, details)
  const saving = pendingKey !== null

  const handleAssign = (key: string) => {
    void runSubtitleStyleAssign(key, {
      busy: saving,
      canEdit,
      assign: (k) => assign.mutateAsync(k),
      onPending: setPendingKey,
      onNotice: (messageKey) => setNotice(messageKey ? t(messageKey) : null),
    })
  }

  if (presetsQuery.isLoading || currentQuery.isLoading) {
    return (
      <div
        className="flex items-center gap-2 p-4 text-sm text-[var(--color-text-secondary)]"
        data-testid="subtitle-style-loading"
      >
        <IconLoader2 size={16} className="animate-spin" />
        {t('common:loading')}
      </div>
    )
  }

  if (presetsQuery.isError || currentQuery.isError) {
    return (
      <div className="space-y-3 p-1" data-testid="subtitle-style-error">
        <p className="field-error m-0">{t('media:subtitleStyle.loadError')}</p>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            void presetsQuery.refetch()
            void currentQuery.refetch()
          }}
        >
          {t('common:retry')}
        </button>
      </div>
    )
  }

  if (compact) {
    return (
      <details className="media-config-group" data-testid="subtitle-style-compact">
        <summary>
          <span className="media-render-group-title">
            {t('media:subtitleStyle.compactTitle')}
          </span>
          <span className={cn('chip', assigned && 'chip-overridden')} data-testid="subtitle-style-compact-status">
            {assigned ? assigned.name : t('media:subtitleStyle.noneShort')}
          </span>
        </summary>
        <div className="space-y-2 pt-2">
          <p className="field-help m-0">{t('media:subtitleStyle.compactHint')}</p>
          {notice && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
              data-testid="subtitle-style-notice"
            >
              <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
              {notice}
            </div>
          )}
          {currentQuery.data && !assigned && (
            <p className="m-0 font-mono text-xs text-[var(--color-text-tertiary)]">
              {currentQuery.data.font_family} · {currentQuery.data.font_size}px ·{' '}
              {currentQuery.data.primary_color}
            </p>
          )}
          {presets.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              {t('media:subtitleStyle.emptyTitle')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="subtitle-style-list">
              {presets.map((preset) => {
                const active = assigned?.key === preset.key
                return (
                  <button
                    key={preset.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!canEdit || saving}
                    title={`${preset.key}${preset.language ? ` · ${preset.language}` : ''}`}
                    data-testid={`subtitle-style-preset-${preset.key}`}
                    onClick={() => handleAssign(preset.key)}
                    className={cn(
                      'media-style-chip',
                      active && 'active',
                      (!canEdit || saving) && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {active && <IconCheck size={13} />}
                    {preset.name}
                    {pendingKey === preset.key && <IconLoader2 size={13} className="animate-spin" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </details>
    )
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
          data-testid="subtitle-style-notice"
        >
          <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
          {notice}
        </div>
      )}

      <section
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4"
        data-testid="subtitle-style-current"
      >
        <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
          {t('media:subtitleStyle.currentTitle')}
        </div>
        {!currentQuery.data ? (
          <p className="m-0 mt-1 text-sm text-[var(--color-text-secondary)]">
            {t('media:subtitleStyle.none')}
          </p>
        ) : assigned ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{assigned.name}</span>
            <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
              {assigned.key}
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {t('media:subtitleStyle.revision', { value: assigned.revision })}
            </span>
          </div>
        ) : (
          // Assigned snapshots are immutable while presets can change — a legacy
          // job may hold a snapshot no live preset reproduces.
          <div className="mt-1 text-sm">
            <p className="m-0 font-semibold text-[var(--color-text-secondary)]">
              {t('media:subtitleStyle.presetUnavailable')}
            </p>
            <p className="m-0 mt-1 text-[var(--color-text-secondary)]">
              {t('media:subtitleStyle.unknownPreset')}
            </p>
            <p className="m-0 mt-1 font-mono text-xs text-[var(--color-text-tertiary)]">
              {currentQuery.data.font_family} · {currentQuery.data.font_size}px ·{' '}
              {currentQuery.data.primary_color}
            </p>
          </div>
        )}
      </section>

      {presets.length === 0 ? (
        <EmptyState
          icon={<IconTypography size={28} />}
          title={t('media:subtitleStyle.emptyTitle')}
          description={t('media:subtitleStyle.emptyDesc')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="subtitle-style-list">
          {presets.map((preset) => (
            <PresetCard
              key={preset.key}
              preset={preset}
              active={assigned?.key === preset.key}
              saving={pendingKey === preset.key}
              disabled={!canEdit || saving}
              onSelect={() => handleAssign(preset.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type CardProps = {
  preset: SubtitleStylePreset
  active: boolean
  saving: boolean
  disabled: boolean
  onSelect: () => void
}

function PresetCard({ preset, active, saving, disabled, onSelect }: CardProps) {
  const { t } = useTranslation(['media'])

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      data-testid={`subtitle-style-preset-${preset.key}`}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition',
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {preset.thumbnail ? (
        <img
          src={preset.thumbnail}
          alt=""
          className="h-12 w-20 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span
          className="grid h-12 w-20 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)]"
          data-testid="subtitle-style-thumb-fallback"
        >
          <IconTypography size={18} />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{preset.name}</span>
          {active && (
            <span className="media-action-needed-pill">
              <IconCheck size={12} /> {t('media:subtitleStyle.activeBadge')}
            </span>
          )}
          {saving && <IconLoader2 size={14} className="animate-spin" />}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-text-tertiary)]">
          <span className="font-mono">{preset.key}</span>
          {preset.language && <span>· {preset.language}</span>}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
          {preset.preview_text || t('media:subtitleStyle.noPreviewText')}
        </span>
      </span>
    </button>
  )
}
