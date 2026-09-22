import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconBolt, IconLoader2, IconWaveSine } from '@tabler/icons-react'
import { cn } from '@/lib/cn'
import {
  modeAvailability,
  reasonI18nKey,
  selectableModes,
} from '@/lib/transformationCapabilities'
import type { AudioExecutionMode, AvailabilityProjection } from '@/types/transformation'

type Props = {
  projection: AvailabilityProjection | undefined
  value: AudioExecutionMode | null
  loading?: boolean
  error?: boolean
  disabled?: boolean
  onChange: (mode: AudioExecutionMode) => void
}

const MODE_ICONS: Record<string, typeof IconBolt> = {
  FAST: IconBolt,
  STUDIO: IconWaveSine,
}

/**
 * CT10.3B execution mode selector.
 *
 * Options come exclusively from the backend Availability Projection. The
 * component performs no local capability inference and never substitutes an
 * unavailable selection with an available one — an unavailable mode is shown,
 * disabled, with the backend's own symbolic reason.
 */
export function ExecutionModeSelector({
  projection,
  value,
  loading = false,
  error = false,
  disabled = false,
  onChange,
}: Props) {
  const { t } = useTranslation(['media', 'common'])

  if (error) {
    return (
      <div className="media-config-block" data-testid="execution-mode-error">
        <div className="field-label">{t('media:executionMode.label')}</div>
        <p className="mb-0 flex items-center gap-1.5 text-xs text-[var(--color-error)]">
          <IconAlertTriangle size={14} />
          {t('media:executionMode.loadError')}
        </p>
      </div>
    )
  }

  if (loading || !projection) {
    return (
      <div className="media-config-block" data-testid="execution-mode-loading">
        <div className="field-label">{t('media:executionMode.label')}</div>
        <p className="mb-0 flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
          <IconLoader2 size={14} className="animate-spin" />
          {t('media:executionMode.loading')}
        </p>
      </div>
    )
  }

  const modes = selectableModes(projection)

  if (modes.length === 0) {
    return (
      <div className="media-config-block" data-testid="execution-mode-empty">
        <div className="field-label">{t('media:executionMode.label')}</div>
        <p className="mb-0 text-xs text-[var(--color-text-tertiary)]">
          {t('media:executionMode.noneSupported')}
        </p>
      </div>
    )
  }

  return (
    <div className="media-config-block media-execution-mode-block" data-testid="execution-mode-selector">
      <div className="flex items-center justify-between mb-2">
        <div className="field-label m-0 text-xs font-semibold text-[var(--color-text-secondary)]">
          {t('media:executionMode.label')}
        </div>
      </div>
      <div
        className="grid gap-2.5 sm:grid-cols-2"
        role="radiogroup"
        aria-label={t('media:executionMode.label')}
      >
        {modes.map((mode) => {
          const availability = modeAvailability(projection, mode)
          const available = availability?.available === true
          const reason = availability?.unavailableReason ?? null
          const Icon = MODE_ICONS[mode] ?? IconBolt
          const isDefault = projection.defaultExecutionMode === mode
          const isSelected = value === mode

          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={!available}
              data-mode={mode}
              data-available={String(available)}
              className={cn(
                'media-mode-card media-mode-card-compact text-left',
                isSelected && 'selected',
              )}
              disabled={disabled || !available}
              onClick={() => onChange(mode)}
            >
              <div className="mb-1 flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
                    isSelected
                      ? 'bg-[var(--color-media)] text-white'
                      : 'bg-[var(--color-media-soft)] text-[var(--color-media)]',
                  )}
                >
                  <Icon size={14} />
                </div>
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {t(`media:executionMode.mode.${mode}`, { defaultValue: mode })}
                </span>
                {isDefault && (
                  <span className="media-consent-version text-[10px] py-0.5 px-1.5">
                    {t('media:executionMode.default')}
                  </span>
                )}
                <span
                  className={cn('media-recipe-radio ml-auto scale-90', isSelected && 'active')}
                  aria-hidden="true"
                />
              </div>
              <div className="text-[11.5px] text-[var(--color-text-secondary)] leading-snug">
                {t(`media:executionMode.modeDesc.${mode}`, { defaultValue: '' })}
              </div>
              {!available && reason && (
                <div
                  className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--color-warning)]"
                  data-testid={`execution-mode-reason-${mode}`}
                >
                  <IconAlertTriangle size={13} className="mt-px shrink-0" />
                  {/* Unknown backend codes render verbatim — no FE business rules. */}
                  <span>{t(reasonI18nKey(reason), { defaultValue: reason })}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
