/**
 * Phase C — shared TTS voice/provider selection helpers.
 *
 * This module is the ONLY place where voice→target-language compatibility is
 * computed (C3). It mirrors the backend's `MediaLanguageValidator.samePrimaryLanguage`
 * (docs/93 Phase B B6): compare the 2-char primary language portions, so
 * "vi" matches "vi-VN" and "en-US" matches "en". Do not invent an
 * exact-language-only rule — the backend supports compatible variants.
 */
import type { ProviderConfig, TtsVoice } from '@/types/provider'

/**
 * Primary (2-char) language compatibility, mirroring the backend validator.
 * Null/blank on either side → false.
 */
export function voiceMatchesTargetLang(
  voice: { language?: string | null; languages?: string[] | null },
  targetLang?: string | null,
): boolean {
  if (!targetLang) return false
  const primary2 = targetLang.trim().toLowerCase().split(/[-_]/, 2)[0]
  if (!primary2) return false
  // V39 — a multilingual voice matches through ANY stored compatibility code;
  // unknown codes ("und") never equal a real primary code.
  for (const candidate of voice.languages ?? []) {
    const primary1 = (candidate ?? '').trim().toLowerCase().split(/[-_]/, 2)[0]
    if (primary1 && primary1 === primary2) return true
  }
  // Legacy single-value column fallback.
  if (!voice.language) return false
  const primary1 = voice.language.trim().toLowerCase().split(/[-_]/, 2)[0]
  return Boolean(primary1) && primary1 === primary2
}

/** Active voices whose language is compatible with the target language. */
export function filterCompatibleActiveVoices(
  voices: TtsVoice[] | undefined,
  targetLang?: string | null,
): TtsVoice[] {
  return (voices ?? []).filter(
    (voice) => voice.isActive && voiceMatchesTargetLang(voice, targetLang),
  )
}

/**
 * First compatible active voice in API order (language ASC, displayName ASC —
 * same ordering the backend voice catalog returns).
 */
export function selectDefaultVoice(
  voices: TtsVoice[] | undefined,
  targetLang?: string | null,
): TtsVoice | null {
  return filterCompatibleActiveVoices(voices, targetLang)[0] ?? null
}

/** A provider usable for TTS (capability flag only — not enabled/disabled). */
export function isTtsProvider(provider: ProviderConfig): boolean {
  return provider.capabilities.includes('TTS')
}

// Lazy singleton — construction can throw on runtimes without ICU support.
let languageDisplayNames: Intl.DisplayNames | null = null
function voiceDisplayNames(): Intl.DisplayNames | null {
  if (languageDisplayNames) return languageDisplayNames
  try {
    languageDisplayNames = new Intl.DisplayNames(undefined, { type: 'language' })
    return languageDisplayNames
  } catch {
    return null
  }
}

/**
 * Human-readable name for a normalized primary code ("vi" → "Vietnamese"),
 * falling back to the canonical code itself. Display-only — the canonical
 * value everywhere remains the normalized code.
 */
export function formatVoiceLanguage(code: string): string {
  const names = voiceDisplayNames()
  if (!names) return code
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Workspace default TTS provider (enabled + TTS + defaultFor includes TTS).
 * Falls back to the first enabled TTS provider; undefined when none exists.
 */
export function defaultTtsProvider(
  providers: ProviderConfig[] | undefined,
): ProviderConfig | undefined {
  const tts = (providers ?? []).filter((p) => p.enabled && isTtsProvider(p))
  return (
    tts.find((p) => p.defaultFor?.includes('TTS'))
    ?? tts[0]
    ?? undefined
  )
}

/**
 * Returns null when the given voice remains compatible with the target
 * language; otherwise the new compatible default voice (or null when none).
 * The caller applies this when the target language changes so a stale voice
 * can never be submitted (C2/C8 — P1 fix).
 */
export function resetVoiceForTargetLang(
  currentVoiceId: string | null | undefined,
  voices: TtsVoice[] | undefined,
  targetLang?: string | null,
): string | null | undefined {
  if (!currentVoiceId) return undefined
  const current = (voices ?? []).find((v) => v.id === currentVoiceId)
  if (current && voiceMatchesTargetLang(current, targetLang)) return undefined
  return selectDefaultVoice(voices, targetLang)?.id ?? null
}

/**
 * Display label for a provider in TTS selectors. `local_piper` renders via
 * i18n ("Piper (Local)") — no hardcoded label (P2 fix); everything else uses
 * the provider display name. `t` is the translate fn from `useTranslation`;
 * when omitted the caller is expected to translate the returned key itself.
 */
export function providerDisplayName(
  provider: ProviderConfig | undefined,
  t?: (key: string) => string,
): string | null {
  if (!provider) return null
  if (provider.protocol === 'local_piper') {
    return t ? t('media:voice.localPiper') : 'media:voice.localPiper'
  }
  return provider.displayName
}

/**
 * All-or-nothing provider/voice selection emitted by the VoiceSelector.
 * A complete pair (provider+voice) means "bind this"; both null means
 * "deselect / keep original audio". Partial pairs never exist on the wire.
 */
export type VoiceSelection = {
  providerId: string | null
  voiceId: string | null
}

/** True when both halves of the pair are present (a bindable selection). */
export function isCompleteVoicePair(selection: VoiceSelection): boolean {
  return selection.providerId != null && selection.voiceId != null
}

/** True when the selection explicitly means "keep original audio" (deselect). */
export function isDeselectSelection(selection: VoiceSelection): boolean {
  return selection.providerId == null && selection.voiceId == null
}

/**
 * The transient selection emitted while a provider switch is in flight (voices
 * loading) or the new provider has no compatible voice. Both halves are null —
 * but this is NOT a deselect intent; it only tells the caller the previous
 * selection is no longer valid (Create gates on it, Job Studio ignores it).
 */
export function providerSwitchReset(): VoiceSelection {
  return { providerId: null, voiceId: null }
}
