import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconLoader2,
  IconMicrophone2,
  IconPlayerPlay,
  IconVolume,
} from '@tabler/icons-react'
import { useTtsVoices, useVoicePreview } from '@/hooks/useProviders'
import {
  filterCompatibleActiveVoices,
  isTtsProvider,
  providerDisplayName,
  providerSwitchReset,
  selectDefaultVoice,
  type VoiceSelection,
} from '@/lib/media/voiceSelection'
import { cn } from '@/lib/cn'
import type { ProviderConfig } from '@/types/provider'

type Props = {
  workspaceId: string
  /** TTS-capable providers (enabled or not — the selector hides disabled ones). */
  providers: ProviderConfig[]
  targetLang?: string | null
  /** Pre-selected provider (job binding for Job Studio, default for create). */
  selectedProviderId?: string | null
  /** Pre-selected voice row id (job binding for Job Studio). */
  selectedVoiceId?: string | null
  disabled?: boolean
  /**
   * C2 UX (docs/19 §1.8.2): when true a "Preview" (Nghe thử) button renders
   * next to the voice select — plays the selected voice through the workspace
   * preview endpoint; never part of the create payload. Create form uses it;
   * Job Studio keeps the plain selector.
   */
  showPreview?: boolean
  /**
   * When true a "Keep original voice" checkbox is offered. Checking it
   * deselects the TTS binding and disables the provider/voice controls until
   * the user unticks it.
   */
  allowOriginal?: boolean
  /**
   * Authoritative job state for the original-audio checkbox. When true, the
   * selector starts with TTS controls disabled.
   */
  originalSelected?: boolean
  /**
   * When true the selector auto-selects the first compatible voice after a
   * provider switch and emits the complete pair through `onChange`. Create
   * Job uses this so the form is always ready to submit. Job Studio leaves it
   * OFF: the bound job must stay untouched until the user explicitly picks a
   * voice (C4 — never auto-bind over the current binding).
   */
  autoSelect?: boolean
  /**
   * Committed selection — emitted ONLY on a complete pair (provider+voice) or
   * an explicit "Keep original voice" ({null, null} when allowOriginal).
   * Job Studio calls the authoritative API on this.
   */
  onChange: (selection: VoiceSelection) => void
  /** Reports the explicit original-audio toggle independently of selection loading state. */
  onOriginalChange?: (selected: boolean) => void
  /**
   * Transient notification that the previous selection is no longer valid —
   * emitted while a provider switch is in flight (voices loading) or the new
   * provider has no compatible voice. It is NOT a deselect intent and must
   * never be sent to the backend. Create gates on it; Job Studio ignores it.
   */
  onPendingChange?: (selection: VoiceSelection) => void
}

/**
 * Phase C — shared TTS provider + voice selector (C3).
 *
 * Rules enforced here (mirroring backend Phase B validation):
 * - providers shown are enabled + TTS-capable only; local_piper renders as
 *   "Piper (Local)" through the normal provider catalog — no hardcoded catalog.
 * - voices shown are active + target-language compatible only.
 * - `onChange` only ever receives an all-or-nothing COMMITTED selection:
 *   a complete pair, or an explicit deselect (Keep original). Provider
 *   switches emit through `onPendingChange` so callers can gate without ever
 *   sending a transient reset to the backend (BA re-review vòng 3 P1 fix).
 * - when a provider has no compatible voice the empty state is explicit and
 *   no committed selection is emitted.
 * - a pre-selected provider that is no longer in the workspace is surfaced as
 *   a read-only notice — never silently replaced by the workspace default.
 */
export function VoiceSelector({
  workspaceId,
  providers,
  targetLang,
  selectedProviderId,
  selectedVoiceId,
  disabled,
  showPreview = false,
  allowOriginal = false,
  originalSelected,
  autoSelect = false,
  onChange,
  onOriginalChange,
  onPendingChange,
}: Props) {
  const { t } = useTranslation(['media', 'common'])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onPendingRef = useRef(onPendingChange)
  onPendingRef.current = onPendingChange
  // C2 UX: inline (create form) preview — plays the selected voice through
  // the workspace preview endpoint; never part of the create payload.
  const preview = useVoicePreview(workspaceId)
  const audioSourceName = useId()
  const providerSelectRef = useRef<HTMLSelectElement>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const selectableProviders = useMemo(
    () => providers.filter((p) => p.enabled && isTtsProvider(p)),
    [providers],
  )

  // The bound provider may be missing from the list (deleted / moved out of
  // workspace) — keep showing it as a read-only notice instead of falling back.
  const boundProviderMissing =
    selectedProviderId != null
    && !selectableProviders.some((p) => p.id === selectedProviderId)

  const [providerId, setProviderId] = useState<string | null>(
    selectedProviderId != null && selectableProviders.some((p) => p.id === selectedProviderId)
      ? selectedProviderId
      : null,
  )
  const [voiceId, setVoiceId] = useState<string | null>(null)
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null)
  const [keepOriginal, setKeepOriginal] = useState(
    allowOriginal
    && (originalSelected ?? (selectedProviderId == null && selectedVoiceId == null)),
  )

  // Re-sync external selection (job binding reload, create-flow default) into
  // local state — without clobbering a user in-flight choice.
  useEffect(() => {
    if (!allowOriginal) {
      setKeepOriginal(false)
      return
    }
    if (
      originalSelected === true
      || (
        originalSelected === undefined
        && selectedProviderId == null
        && selectedVoiceId == null
      )
    ) {
      setKeepOriginal(true)
      setProviderId(null)
      setVoiceId(null)
      setPendingProviderId(null)
      return
    }
    if (originalSelected === false) {
      setKeepOriginal(false)
    }
    if (selectedProviderId != null && selectableProviders.some((p) => p.id === selectedProviderId)) {
      setProviderId(selectedProviderId)
    }
  }, [allowOriginal, originalSelected, selectedProviderId, selectedVoiceId, selectableProviders])

  useEffect(() => {
    if (selectedVoiceId != null && !keepOriginal) {
      setVoiceId(selectedVoiceId)
    }
  }, [selectedVoiceId, keepOriginal])

  const activeProviderId = pendingProviderId ?? providerId
  const voicesQuery = useTtsVoices(workspaceId, activeProviderId ?? undefined)

  const compatibleVoices = useMemo(
    () => filterCompatibleActiveVoices(voicesQuery.data, targetLang),
    [voicesQuery.data, targetLang],
  )

  // Provider changed → the previous selection is no longer valid. This is a
  // TRANSIENT reset: it goes through onPendingChange (never onChange) so the
  // backend is never called with a deselect during a provider switch. With
  // autoSelect (Create), the first compatible voice is picked once voices
  // load and a committed pair is emitted through onChange.
  const handleProviderChange = (next: string) => {
    setKeepOriginal(false)
    setPendingProviderId(next)
    setProviderId(null)
    setVoiceId(null)
    onPendingRef.current?.(providerSwitchReset())
  }

  // Voices for the newly selected provider arrived:
  // - autoSelect (Create): auto-select the first compatible voice and emit
  //   the committed pair. No compatible voice → stay on the empty state, no
  //   committed selection (the caller's gate blocks submission).
  // - Job Studio (autoSelect=false): the bound job stays untouched — no
  //   committed selection is emitted until the user picks a voice.
  useEffect(() => {
    if (!pendingProviderId || voicesQuery.isPending) return
    const first = autoSelect ? selectDefaultVoice(voicesQuery.data, targetLang) : null
    if (first) {
      setPendingProviderId(null)
      setProviderId(pendingProviderId)
      setVoiceId(first.id)
      onChangeRef.current({ providerId: pendingProviderId, voiceId: first.id })
    } else if (!autoSelect) {
      // Job Studio: provider is now selected but no voice was auto-picked —
      // surface the new provider's voices for the user to choose; the bound
      // job remains unchanged until a voice is explicitly selected.
      setPendingProviderId(null)
      setProviderId(pendingProviderId)
      setVoiceId(null)
      onPendingRef.current?.(providerSwitchReset())
    } else {
      // Create with no compatible voice: keep the provider (empty state),
      // never emit provider-without-voice.
      setPendingProviderId(null)
      setProviderId(pendingProviderId)
      setVoiceId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProviderId, compatibleVoices.length, voicesQuery.isPending, autoSelect])

  const handleVoiceChange = (next: string) => {
    if (!providerId) return
    setKeepOriginal(false)
    const value = next || null
    setVoiceId(value)
    // A user-picked voice always forms a committed pair.
    onChangeRef.current({ providerId, voiceId: value })
  }

  const handleOriginal = () => {
    setKeepOriginal(true)
    setPendingProviderId(null)
    setProviderId(null)
    setVoiceId(null)
    onChangeRef.current({ providerId: null, voiceId: null })
  }

  const chooseOriginal = () => {
    handleOriginal()
    onOriginalChange?.(true)
  }

  // Back to AI dubbing: with autoSelect (Create) pre-pick the first provider so
  // the user lands on a ready-to-submit pair instead of two empty selects.
  const chooseTts = () => {
    setKeepOriginal(false)
    onOriginalChange?.(false)
    if (autoSelect && providerId == null && pendingProviderId == null && selectableProviders[0]) {
      handleProviderChange(selectableProviders[0].id)
    }
  }

  const noProviders = selectableProviders.length === 0
  const loading = Boolean(activeProviderId && voicesQuery.isPending)
  const noCompatible = !loading && !noProviders && providerId != null && compatibleVoices.length === 0

  const selectedVoice = useMemo(
    () => compatibleVoices.find((v) => v.id === voiceId) ?? null,
    [compatibleVoices, voiceId],
  )

  const handlePreview = () => {
    if (!providerId || !selectedVoice || disabled || preview.isPending) return
    setPreviewError(null)
    void preview
      .mutateAsync({
        providerId,
        voiceRowId: selectedVoice.id,
        language: targetLang,
      })
      .catch(() => setPreviewError(t('media:voice.preview.error')))
  }


  const activeProvider = selectableProviders.find((p) => p.id === providerId) ?? null
  const showTtsControls = !(allowOriginal && keepOriginal)

  return (
    <div className="space-y-2.5" data-testid="voice-selector">
      {allowOriginal && (
        <div className="audio-source-seg" role="radiogroup" aria-label={t('media:voice.sourceLabel')}>
          <label className={cn('audio-source-option', !keepOriginal && 'active')}>
            <input
              type="radio"
              name={audioSourceName}
              data-testid="voice-use-tts"
              checked={!keepOriginal}
              disabled={disabled}
              onChange={chooseTts}
            />
            <span className="audio-source-option__icon" aria-hidden>
              <IconMicrophone2 size={16} />
            </span>
            <span className="min-w-0">
              <strong>{t('media:voice.modeTts')}</strong>
              <small>{t('media:voice.modeTtsHint')}</small>
            </span>
          </label>
          <label className={cn('audio-source-option', keepOriginal && 'active')}>
            <input
              type="radio"
              name={audioSourceName}
              data-testid="voice-keep-original"
              checked={keepOriginal}
              disabled={disabled}
              onChange={chooseOriginal}
            />
            <span className="audio-source-option__icon" aria-hidden>
              <IconVolume size={16} />
            </span>
            <span className="min-w-0">
              <strong>{t('media:voice.original')}</strong>
              <small>{t('media:voice.originalHint')}</small>
            </span>
          </label>
        </div>
      )}

      {showTtsControls && (
      <div
        className={cn(
          'grid gap-3 items-end',
          showPreview
            ? 'grid-cols-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto]'
            : 'grid-cols-1 sm:grid-cols-2',
        )}
      >
        {/* Col 1: Provider */}
        <div className="min-w-0">
          <label className="field-label mb-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
              <IconMicrophone2 size={13} className="text-[var(--color-media)]" />
              {t('media:voice.providerLabel')}
            </span>
            <select
              ref={providerSelectRef}
              className="field-input mt-1 w-full"
              data-testid="voice-provider-select"
              value={providerId ?? ''}
              disabled={disabled || loading || boundProviderMissing || keepOriginal}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              {!providerId && <option value="">{t('media:voice.providerPlaceholder')}</option>}
              {selectableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {providerDisplayName(provider, t) ?? provider.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Col 2: Voice */}
        <div className="min-w-0">
          <label className="field-label mb-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-secondary)]">
              <IconMicrophone2 size={13} className="text-[var(--color-media)]" />
              {t('media:voice.label')}
            </span>
            {loading ? (
              <div className="field-input mt-1 flex items-center gap-2 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-bg-surface-2)]">
                <IconLoader2 size={14} className="animate-spin text-[var(--color-media)]" />
                <span>{t('common:loading')}</span>
              </div>
            ) : (
              <select
                className="field-input mt-1 w-full"
                data-testid="voice-voice-select"
                value={voiceId ?? ''}
                disabled={disabled || keepOriginal || !providerId}
                onChange={(e) => handleVoiceChange(e.target.value)}
              >
                {!voiceId && <option value="">{t('media:voice.voicePlaceholder')}</option>}
                {compatibleVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.displayName || voice.voiceId}
                    {' · '}
                    {voice.gender}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>

        {/* Col 3: Preview button */}
        {showPreview && (
          <div className="shrink-0 pb-[1px]">
            <button
              type="button"
              className="btn-media-secondary btn-sm h-[38px] px-3.5 inline-flex items-center justify-center gap-1.5 whitespace-nowrap w-full sm:w-auto"
              data-testid="voice-preview-button"
              disabled={disabled || keepOriginal || !providerId || !voiceId || preview.isPending}
              onClick={handlePreview}
            >
              {preview.isPending ? (
                <IconLoader2 size={15} className="animate-spin" />
              ) : (
                <IconPlayerPlay size={15} />
              )}
              <span>{t('media:voice.preview.action')}</span>
            </button>
          </div>
        )}
      </div>
      )}

      {boundProviderMissing && (
        <p className="field-error m-0" data-testid="voice-bound-provider-missing">
          {t('media:voice.boundProviderMissing')}
        </p>
      )}

      {noProviders ? (
        <p className="field-error m-0" data-testid="voice-no-providers">
          {t('media:voice.noProviderSelectable')}
        </p>
      ) : null}

      {noCompatible && showTtsControls && (
        <div className="voice-callout" role="alert" data-testid="voice-no-compatible">
          <IconAlertTriangle size={16} className="voice-callout__icon" aria-hidden />
          <div className="min-w-0 flex-1">
            <strong>
              {t('media:voice.noCompatTitle', {
                provider: activeProvider
                  ? providerDisplayName(activeProvider, t) ?? activeProvider.displayName
                  : '',
              })}
            </strong>
            <p>{t('media:voice.emptyCompat')}</p>
            <div className="voice-callout__actions">
              {selectableProviders.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={disabled}
                  onClick={() => providerSelectRef.current?.focus()}
                >
                  {t('media:voice.changeProvider')}
                </button>
              )}
              {allowOriginal && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  data-testid="voice-callout-original"
                  disabled={disabled}
                  onClick={chooseOriginal}
                >
                  {t('media:voice.useOriginal')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {previewError && (
        <p className="field-error m-0" data-testid="voice-preview-error">
          {previewError}
        </p>
      )}
    </div>
  )
}
