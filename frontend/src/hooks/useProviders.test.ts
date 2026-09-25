import { describe, expect, it } from 'vitest'
import { defaultVoicePreviewText, resolveVoiceProviderArg } from '@/hooks/useProviders'

describe('defaultVoicePreviewText', () => {
  it('uses the Vietnamese sample for vi locales', () => {
    expect(defaultVoicePreviewText('vi-VN')).toBe('Xin chào, đây là giọng đọc mẫu.')
  })

  it('falls back to English for other languages', () => {
    expect(defaultVoicePreviewText('ja-JP')).toBe('Hello, this is a sample voice preview.')
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
