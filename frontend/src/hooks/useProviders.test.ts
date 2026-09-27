import { describe, expect, it } from 'vitest'
import { defaultVoicePreviewText, resolveVoiceProviderArg } from '@/hooks/useProviders'

describe('defaultVoicePreviewText', () => {
  it('uses the Vietnamese sample for vi locales', () => {
    expect(defaultVoicePreviewText('vi-VN')).toBe('Xin chào, đây là giọng đọc mẫu.')
  })

  it("speaks the voice's own language (a Korean voice reading English sounded wrong)", () => {
    expect(defaultVoicePreviewText('ko-KR')).toBe('안녕하세요, 샘플 음성입니다.')
    expect(defaultVoicePreviewText('ja-jp')).toBe('こんにちは、これはサンプル音声です。')
  })

  it('falls back to English for languages without a sample', () => {
    expect(defaultVoicePreviewText('sw-KE')).toBe('Hello, this is a sample voice preview.')
    expect(defaultVoicePreviewText(null)).toBe('Hello, this is a sample voice preview.')
  })

  it('keeps every sample within the 50-char preview limit', () => {
    for (const lang of ['vi', 'en', 'ko', 'ja', 'zh', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'th', 'id', 'hi', 'ar']) {
      expect(defaultVoicePreviewText(lang).length).toBeLessThanOrEqual(50)
    }
  })
})
describe('resolveVoiceProviderArg (useTtsVoices / useTtsVoiceLanguages)', () => {
  it('new style (providerId) uses the only argument', () => {
    expect(resolveVoiceProviderArg(['prov-1'])).toBe('prov-1')
  })

  it('old style (workspaceId, providerId) uses the provider', () => {
    expect(resolveVoiceProviderArg(['ws-1', 'prov-1'])).toBe('prov-1')
  })

  it('old style with an unresolved provider stays disabled — never falls back to the workspace id', () => {
    expect(resolveVoiceProviderArg(['ws-1', undefined])).toBeUndefined()
  })
})
