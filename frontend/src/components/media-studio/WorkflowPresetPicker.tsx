/**
 * M-C — Workflow preset picker for the create-job form (docs/16 §7.5,
 * docs/19 §1.8.2). Read-only selection surface: shows active presets across
 * PROJECT / WORKSPACE / SYSTEM scopes, emits the chosen preset id, and renders
 * a resolved summary straight from the backend response (workflow mode +
 * subtitle mode). No FE scoring, no config synthesis — the backend resolves
 * and freezes at create (explicit request fields win over the preset).
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClipboardCheck, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { useWorkflowPresets } from '@/hooks/useWorkflowPresets'
import type {
  SubtitleDisplayMode,
  SubtitleMode,
  WorkflowMode,
  WorkflowPreset,
  WorkflowPresetScope,
} from '@/types/media'

type Props = {
  workspaceId: string
  projectId: string
  /** Selected preset id; null = no preset (recipe default — the backend skips
   * default resolution instead of auto-applying the workspace/system default). */
  value: string | null
  onChange: (presetId: string | null) => void
  disabled?: boolean
  /**
   * C2 (docs/19 §1.8.2): the explicit workflow mode chosen in the create form.
   * When it differs from the preset's own mode, a note explains that the
   * explicit selection wins (Q-M-WORKFLOW-03 JOB override).
   */
  explicitMode?: WorkflowMode | null
}

const SCOPE_ORDER: WorkflowPresetScope[] = ['PROJECT', 'WORKSPACE', 'SYSTEM']

/** Active-only rows — the backend exposes the `active` flag on every preset. */
export function activePresets(presets: WorkflowPreset[] | undefined): WorkflowPreset[] {
  return (presets ?? []).filter((p) => p.active)
}

/** Resolve the currently selected preset among active rows; null when stale. */
export function presetById(
  presets: WorkflowPreset[] | undefined,
  id: string | null,
): WorkflowPreset | null {
  if (!id) return null
  return activePresets(presets).find((p) => p.id === id) ?? null
}

/** i18n key for a scope label (camelCase keys: scopeProject/scopeWorkspace/scopeSystem). */
export function presetScopeLabelKey(scope: WorkflowPresetScope): string {
  return `media:workflowPreset.scope${scope.charAt(0) + scope.slice(1).toLowerCase()}`
}

/** '' renders as "no preset" — the select uses a sentinel empty option. */
export function optionToPresetId(value: string): string | null {
  return value || null
}

/** i18n key for a preset's resolved workflow mode; null when absent. */
export function presetWorkflowModeLabelKey(mode: WorkflowMode | null | undefined): string | null {
  if (mode === 'MANUAL') return 'media:workflow.manual'
  if (mode === 'AUTO') return 'media:workflow.auto'
  return null
}

/** i18n key for a preset's resolved subtitle mode; null when absent. */
export function presetSubtitleModeLabelKey(mode: SubtitleMode | null | undefined): string | null {
  if (mode === 'HARD_SUB') return 'media:subtitleHard'
  if (mode === 'SOFT_SUB') return 'media:subtitleSoft'
  return null
}

/** i18n key for a preset's subtitle display mode (presentation); null when absent. */
export function presetDisplayModeLabelKey(
  mode: SubtitleDisplayMode | null | undefined,
): string | null {
  if (mode === 'SENTENCE') return 'media:renderPrep.displayModeSentence'
  if (mode === 'PHRASE') return 'media:renderPrep.displayModePhrase'
  if (mode === 'WORD') return 'media:renderPrep.displayModeWord'
  if (mode === 'CHARACTERS') return 'media:renderPrep.displayModeCharacters'
  return null
}

export function WorkflowPresetPicker({
  workspaceId,
  projectId,
  value,
  onChange,
  disabled,
  explicitMode,
}: Props) {
  const { t } = useTranslation(['media', 'common'])
  const presets = useWorkflowPresets(workspaceId, projectId)

  // B3: refetch presets when window regains focus or visibility becomes visible.
  useEffect(() => {
    const handleFocus = () => {
      if (typeof presets.refetch === 'function') {
        void presets.refetch()
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && typeof presets.refetch === 'function') {
        void presets.refetch()
      }
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [presets.refetch])

  // BLOCKER M-C-02 fix (fail-closed): a selected preset that can no longer be
  // verified — deactivated/deleted after a refresh, or the list failed to load
  // — is cleared from state so a stale/fabricated id can never reach the create
  // request. The invalid notice stays visible until the user picks again.
  const [invalidated, setInvalidated] = useState(false)
  useEffect(() => {
    if (value == null) return
    if (presets.isPending) return
    if (!presetById(presets.data, value)) {
      setInvalidated(true)
      onChange(null)
    }
  }, [value, presets.data, presets.isPending, onChange])

  const byScope = useMemo(() => {
    const map: Record<WorkflowPresetScope, WorkflowPreset[]> = {
      PROJECT: [],
      WORKSPACE: [],
      SYSTEM: [],
    }
    for (const preset of activePresets(presets.data)) {
      map[preset.scope]?.push(preset)
    }
    return map
  }, [presets.data])

  const selected = presetById(presets.data, value)
  const staleSelected = value != null && !selected
  const hasAny = activePresets(presets.data).length > 0
  const modeLabelKey = presetWorkflowModeLabelKey(selected?.config?.workflowMode)
  const subtitleLabelKey = presetSubtitleModeLabelKey(selected?.config?.subtitleMode)
  const displayLabelKey = presetDisplayModeLabelKey(
    selected?.config?.presentation?.subtitle?.displayMode,
  )
  const maxCharacters = selected?.config?.presentation?.subtitle?.maxCharactersPerCue ?? null
  // C2 (gap 2): the explicit create-form mode wins over the preset mode —
  // surface that when they differ (Q-M-WORKFLOW-03 JOB override).
  const modeOverrideNote =
    selected?.config?.workflowMode != null
    && explicitMode != null
    && selected.config.workflowMode !== explicitMode

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="field-label mb-0">
          <span className="inline-flex items-center gap-1.5">
            <IconClipboardCheck size={14} className="text-[var(--color-media)]" />
            {t('media:workflowPreset.label')}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            title={t('common:refresh', { defaultValue: 'Làm mới' })}
            aria-label={t('common:refresh', { defaultValue: 'Làm mới' })}
            data-testid="preset-refresh-btn"
            disabled={presets.isPending || presets.isFetching}
            onClick={() => void presets.refetch()}
          >
            <IconRefresh size={13} className={presets.isFetching ? 'animate-spin' : ''} />
          </button>
          <a
            href={`/w/${workspaceId}/media/presets`}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-media)] hover:underline"
            target="_blank"
            rel="noreferrer"
            data-testid="preset-manage-link"
          >
            <span>{t('media:workflowPreset.managePresets')}</span>
            <IconExternalLink size={11} />
          </a>
        </div>
      </div>
      <select
        className="field-input"
        value={value ?? ''}
          disabled={disabled || presets.isPending}
          onChange={(e) => {
            setInvalidated(false)
            onChange(optionToPresetId(e.target.value))
          }}
        >
          <option value="">{t('media:workflowPreset.none')}</option>
          {SCOPE_ORDER.map((scope) => {
            const items = byScope[scope]
            if (items.length === 0) return null
            return (
              <optgroup key={scope} label={t(presetScopeLabelKey(scope))}>
                {items.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.isDefault ? ` (${t('media:workflowPreset.default')})` : ''}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>

      {presets.isPending && (
        <p className="field-help m-0">{t('media:workflowPreset.loading')}</p>
      )}
      {presets.isError && !presets.isPending && (
        <p className="field-error m-0">{t('media:workflowPreset.error')}</p>
      )}
      {!presets.isPending && !presets.isError && !hasAny && (
        <p className="field-help m-0">{t('media:workflowPreset.empty')}</p>
      )}
      {(staleSelected || invalidated) && !presets.isPending && (
        <p className="field-error m-0">{t('media:workflowPreset.invalid')}</p>
      )}

      {selected && (
        <div
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-2.5 text-xs media-preset-summary-card"
          data-testid="workflow-preset-summary"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="m-0 font-semibold text-xs text-[var(--color-text-primary)] truncate">
              {selected.name}
            </p>
            <span className="media-scope-badge shrink-0">
              {t(presetScopeLabelKey(selected.scope))}
              {selected.isDefault ? ` · ${t('media:workflowPreset.default')}` : ''}
            </span>
          </div>

          <div className="media-preset-chips-grid">
            {modeLabelKey && (
              <p className="media-preset-chip m-0">
                {t('media:workflowPreset.mode', { mode: t(modeLabelKey) })}
              </p>
            )}
            {subtitleLabelKey && (
              <p className="media-preset-chip m-0">
                {t('media:workflowPreset.subtitle', { mode: t(subtitleLabelKey) })}
              </p>
            )}
            {displayLabelKey && (
              <p className="media-preset-chip m-0">
                {t('media:workflowPreset.display', { mode: t(displayLabelKey) })}
              </p>
            )}
            {maxCharacters != null && (
              <p className="media-preset-chip m-0">
                {t('media:workflowPreset.maxCharacters', { value: String(maxCharacters) })}
              </p>
            )}
            {selected?.config?.ttsProviderId && selected?.config?.ttsVoiceId && (
              <p className="media-preset-chip highlight m-0">
                {t('media:workflowPreset.voiceConfigured')}
              </p>
            )}
          </div>

          {modeOverrideNote && (
            <p className="mb-0.5 mt-1.5 text-[11px] text-[var(--color-warning)]" data-testid="preset-mode-override-note">
              {t('media:workflowPreset.modeOverrideNote', {
                mode: t(explicitMode === 'MANUAL' ? 'media:workflow.manual' : 'media:workflow.auto'),
              })}
            </p>
          )}
          <p className="mb-0 mt-1.5 text-[11px] text-[var(--color-text-tertiary)] leading-tight">
            {t('media:workflowPreset.hint')}
          </p>
        </div>
      )}
    </div>
  )
}
