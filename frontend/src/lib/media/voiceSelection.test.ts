import { describe, expect, it } from 'vitest'
import {
  defaultTtsProvider,
  filterCompatibleActiveVoices,
  groupVoicesForPicker,
  isNativeVoice,
  isCompleteVoicePair,
  isDeselectSelection,
  isTtsProvider,
  providerDisplayName,
  providerSwitchReset,
  resetVoiceForTargetLang,
  selectDefaultVoice,
  voiceMatchesTargetLang,
} from '@/lib/media/voiceSelection'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

function voice(partial: Partial<TtsVoice>): TtsVoice {
  return {
    id: 'v1',
    voiceId: 'voice-1',
    language: 'vi',
    gender: 'FEMALE',
    displayName: 'Vais',
    isActive: true,
    cachedAt: null,
    ...partial,
  }
}

function provider(partial: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'p1',
    displayName: 'Cloud TTS',
    protocol: 'azure_speech',
    capabilities: ['TTS'],
    defaultFor: [],
    baseUrl: 'https://example.test',
    apiKeyHint: null,
    defaultModel: 'm',
    enabled: true,
    ...partial,
  }
}

describe('voiceMatchesTargetLang', () => {
  it('matches the 2-char primary language (vi vs vi-VN)', () => {
    expect(voiceMatchesTargetLang({ language: 'vi' }, 'vi')).toBe(true)
    expect(voiceMatchesTargetLang({ language: 'vi' }, 'vi-VN')).toBe(true)
    expect(voiceMatchesTargetLang({ language: 'vi-VN' }, 'vi')).toBe(true)
  })

  it('mirrors the backend validator for region + case variants', () => {
    expect(voiceMatchesTargetLang({ language: 'en-US' }, 'en')).toBe(true)
    expect(voiceMatchesTargetLang({ language: 'EN' }, 'en')).toBe(true)
    expect(voiceMatchesTargetLang({ language: 'zh-CN' }, 'zh')).toBe(true)
  })

  it('rejects different primary languages', () => {
    expect(voiceMatchesTargetLang({ language: 'en' }, 'vi')).toBe(false)
    expect(voiceMatchesTargetLang({ language: 'ja-JP' }, 'en')).toBe(false)
  })

  it('rejects null/blank on either side (never exact-only invention)', () => {
    expect(voiceMatchesTargetLang({ language: null }, 'vi')).toBe(false)
    expect(voiceMatchesTargetLang({ language: 'vi' }, null)).toBe(false)
    expect(voiceMatchesTargetLang({ language: '' }, 'vi')).toBe(false)
    expect(voiceMatchesTargetLang({ language: 'vi' }, '')).toBe(false)
  })

  // V39 — multilingual voices match through ANY stored compatibility code.
  it('matches through any stored compatibility language', () => {
    expect(
      voiceMatchesTargetLang({ language: 'ja', languages: ['ja', 'vi', 'en'] }, 'vi'),
    ).toBe(true)
    expect(
      voiceMatchesTargetLang({ language: 'ja', languages: ['ja', 'en'] }, 'vi-VN'),
    ).toBe(false)
  })

  it('unknown codes in the list never make a voice compatible', () => {
    expect(
      voiceMatchesTargetLang({ language: 'und', languages: ['und'] }, 'vi'),
    ).toBe(false)
  })

  it('falls back to the single-value column when languages is absent', () => {
    expect(voiceMatchesTargetLang({ language: 'ko' }, 'ko-KR')).toBe(true)
    expect(voiceMatchesTargetLang({ languages: undefined, language: 'en' }, 'en-US')).toBe(true)
  })
})

describe('filterCompatibleActiveVoices', () => {
  const voices = [
    voice({ id: 'a', language: 'vi', isActive: true }),
    voice({ id: 'b', language: 'vi-VN', isActive: true }),
    voice({ id: 'c', language: 'en', isActive: true }),
    voice({ id: 'd', language: 'vi', isActive: false }), // inactive must be hidden
  ]

  it('keeps only active + compatible voices', () => {
    const result = filterCompatibleActiveVoices(voices, 'vi')
    expect(result.map((v) => v.id)).toEqual(['a', 'b'])
  })

  it('keeps multilingual voices compatible with several targets', () => {
    const polyglot = [
      voice({ id: 'multi', language: 'ja', languages: ['ja', 'vi'], isActive: true }),
      voice({ id: 'ko', language: 'ko', isActive: true }),
    ]
    expect(filterCompatibleActiveVoices(polyglot, 'vi').map((v) => v.id)).toEqual(['multi'])
    expect(filterCompatibleActiveVoices(polyglot, 'ja-JP').map((v) => v.id)).toEqual(['multi'])
    expect(filterCompatibleActiveVoices(polyglot, 'ko').map((v) => v.id)).toEqual(['ko'])
  })

  it('handles undefined voices and targetLang', () => {
    expect(filterCompatibleActiveVoices(undefined, 'vi')).toEqual([])
    expect(filterCompatibleActiveVoices(voices, null)).toEqual([])
  })
})

describe('selectDefaultVoice', () => {
  it('picks the first compatible active voice', () => {
    const result = selectDefaultVoice(
      [voice({ id: 'en1', language: 'en' }), voice({ id: 'vi1', language: 'vi' })],
      'vi',
    )
    expect(result?.id).toBe('vi1')
  })

  it('returns null when nothing matches', () => {
    expect(selectDefaultVoice([voice({ id: 'en1', language: 'en' })], 'vi')).toBeNull()
  })

  it('prefers a native GA voice over multilingual and preview voices', () => {
    // Azure: a PREVIEW Arabic multilingual voice used to be picked for Vietnamese.
    const result = selectDefaultVoice(
      [
        voice({ id: 'ar', language: 'ar-ae', languages: ['ar', 'vi'], status: 'PREVIEW' }),
        voice({ id: 'viHd', language: 'vi-vn', languages: ['vi'], status: 'PREVIEW' }),
        voice({ id: 'viGa', language: 'vi-vn', languages: ['vi'], status: 'GA' }),
      ],
      'vi',
    )
    expect(result?.id).toBe('viGa')
  })

  it('falls back to a multilingual voice when no native one exists', () => {
    const result = selectDefaultVoice(
      [voice({ id: 'multi', language: 'en-us', languages: ['en', 'lo'] })],
      'lo',
    )
    expect(result?.id).toBe('multi')
  })
})

describe('isNativeVoice', () => {
  it('compares the voice primary language only, not multilingual support', () => {
    expect(isNativeVoice(voice({ language: 'en-gb', languages: ['en'] }), 'en-US')).toBe(true)
    expect(isNativeVoice(voice({ language: 'de-de', languages: ['de', 'en'] }), 'en')).toBe(false)
    expect(isNativeVoice(voice({ language: 'vi' }), null)).toBe(false)
  })
})

describe('groupVoicesForPicker', () => {
  const catalog = [
    voice({ id: 'hoaimy', voiceId: 'vi-VN-HoaiMyNeural', language: 'vi-vn', languages: ['vi'], displayName: 'Hoài My', gender: 'FEMALE' }),
    voice({ id: 'namminh', voiceId: 'vi-VN-NamMinhNeural', language: 'vi-vn', languages: ['vi'], displayName: 'Nam Minh', gender: 'MALE' }),
    voice({ id: 'ava', voiceId: 'en-US-AvaMultilingualNeural', language: 'en-us', languages: ['en', 'vi'], displayName: 'Ava Multilingual', gender: 'FEMALE' }),
    voice({ id: 'andrew', voiceId: 'en-US-AndrewMultilingualNeural', language: 'en-us', languages: ['en', 'vi'], displayName: 'Andrew Multilingual', gender: 'MALE' }),
  ]

  it('groups native voices by locale, then one multilingual group, keeping API order', () => {
    const groups = groupVoicesForPicker(catalog, 'vi')
    expect(groups.map((g) => [g.kind, g.locale, g.voices.map((v) => v.id)])).toEqual([
      ['native', 'vi-vn', ['hoaimy', 'namminh']],
      ['multilingual', null, ['ava', 'andrew']],
    ])
  })

  it('searches name, id and locale ignoring case and accents', () => {
    const ids = (q: string) => groupVoicesForPicker(catalog, 'vi', { query: q }).flatMap((g) => g.voices.map((v) => v.id))
    expect(ids('hoai my')).toEqual(['hoaimy'])
    expect(ids('ANDREW')).toEqual(['andrew'])
    expect(ids('en-us')).toEqual(['ava', 'andrew'])
    expect(ids('zzz')).toEqual([])
  })

  it('filters by gender and always keeps the selected voice visible', () => {
    const groups = groupVoicesForPicker(catalog, 'vi', { gender: 'MALE', keepVoiceId: 'ava' })
    expect(groups.flatMap((g) => g.voices.map((v) => v.id))).toEqual(['namminh', 'ava', 'andrew'])
  })

  it('drops inactive and incompatible voices', () => {
    const groups = groupVoicesForPicker(
      [...catalog, voice({ id: 'off', language: 'vi', isActive: false }), voice({ id: 'ja', language: 'ja-jp', languages: ['ja'] })],
      'vi',
    )
    const ids = groups.flatMap((g) => g.voices.map((v) => v.id))
    expect(ids).not.toContain('off')
    expect(ids).not.toContain('ja')
  })
})

describe('isTtsProvider / defaultTtsProvider', () => {
  it('flags TTS capability', () => {
    expect(isTtsProvider(provider({ capabilities: ['TTS'] }))).toBe(true)
    expect(isTtsProvider(provider({ capabilities: ['TEXT'] }))).toBe(false)
  })

  it('prefers the workspace default, then first enabled TTS provider', () => {
    const a = provider({ id: 'a', capabilities: ['TTS'], defaultFor: ['TTS'] })
    const b = provider({ id: 'b', capabilities: ['TTS'], defaultFor: [] })
    expect(defaultTtsProvider([b, a])?.id).toBe('a')
    expect(defaultTtsProvider([b])?.id).toBe('b')
  })

  it('skips disabled providers', () => {
    const disabled = provider({ id: 'd', capabilities: ['TTS'], enabled: false })
    expect(defaultTtsProvider([disabled])).toBeUndefined()
    expect(defaultTtsProvider([])).toBeUndefined()
  })
})

describe('providerDisplayName', () => {
  it('renders local_piper through i18n, never a hardcoded catalog label', () => {
    const piper = provider({ id: 'p', protocol: 'local_piper', displayName: 'Piper (Local)' })
    // With a translate fn the label comes from i18n.
    expect(providerDisplayName(piper, (k) => `T:${k}`)).toBe('T:media:voice.localPiper')
    // Without a fn the raw i18n KEY is returned (the caller translates).
    expect(providerDisplayName(piper)).toBe('media:voice.localPiper')
  })

  it('uses the provider display name otherwise', () => {
    expect(providerDisplayName(provider({ displayName: 'Azure Speech' }))).toBe('Azure Speech')
    expect(providerDisplayName(undefined)).toBeNull()
  })
})

describe('resetVoiceForTargetLang', () => {
  const voices = [
    voice({ id: 'vi1', language: 'vi' }),
    voice({ id: 'en1', language: 'en' }),
  ]

  it('keeps the voice when still compatible with the new target language', () => {
    expect(resetVoiceForTargetLang('vi1', voices, 'vi-VN')).toBeUndefined()
  })

  it('resets to the new compatible default when the current voice is stale', () => {
    expect(resetVoiceForTargetLang('vi1', voices, 'en')).toBe('en1')
    expect(resetVoiceForTargetLang('en1', voices, 'en')).toBeUndefined()
  })

  it('returns null when no voice matches the new target language', () => {
    expect(resetVoiceForTargetLang('vi1', voices, 'ja')).toBeNull()
  })

  it('is a no-op without a current voice', () => {
    expect(resetVoiceForTargetLang(null, voices, 'vi')).toBeUndefined()
    expect(resetVoiceForTargetLang(undefined, voices, 'vi')).toBeUndefined()
  })
})

describe('selection predicates (BA re-review v3)', () => {
  it('isCompleteVoicePair only accepts both halves', () => {
    expect(isCompleteVoicePair({ providerId: 'p', voiceId: 'v' })).toBe(true)
    expect(isCompleteVoicePair({ providerId: 'p', voiceId: null })).toBe(false)
    expect(isCompleteVoicePair({ providerId: null, voiceId: 'v' })).toBe(false)
    expect(isCompleteVoicePair({ providerId: null, voiceId: null })).toBe(false)
  })

  it('isDeselectSelection only accepts both null', () => {
    expect(isDeselectSelection({ providerId: null, voiceId: null })).toBe(true)
    expect(isDeselectSelection({ providerId: 'p', voiceId: 'v' })).toBe(false)
    expect(isDeselectSelection({ providerId: 'p', voiceId: null })).toBe(false)
  })

  it('providerSwitchReset is the transient reset (NOT a deselect intent)', () => {
    expect(providerSwitchReset()).toEqual({ providerId: null, voiceId: null })
    // It is a reset used to gate the parent — never a committed deselect.
    expect(isDeselectSelection(providerSwitchReset())).toBe(true)
    // But callers distinguish it by routing: pending vs committed.
    expect(isCompleteVoicePair(providerSwitchReset())).toBe(false)
  })
})
