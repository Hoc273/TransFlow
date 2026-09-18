import { describe, expect, it } from 'vitest'
import { defaultVoicePreviewText } from '@/hooks/useProviders'

describe('defaultVoicePreviewText', () => {
  it('uses the Vietnamese sample for vi locales', () => {
    expect(defaultVoicePreviewText('vi-VN')).toBe('Xin chào, đây là giọng đọc mẫu.')
  })

  it('falls back to English for other languages', () => {
    expect(defaultVoicePreviewText('ja-JP')).toBe('Hello, this is a sample voice preview.')
  })
})
