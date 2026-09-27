import { describe, expect, it } from 'vitest'
import {
  defaultBaseUrlFor,
  defaultModelFor,
  isModelUnused,
  protocolSupports,
  supportedSubset,
} from './providerProtocols'

describe('providerProtocols', () => {
  it('mirrors adapter capabilities (TEXT ↔ TRANSLATE)', () => {
    expect(protocolSupports('anthropic', 'TEXT')).toBe(true)
    expect(protocolSupports('anthropic', 'TRANSLATE')).toBe(true)
    expect(protocolSupports('anthropic', 'VISION')).toBe(true)
    expect(protocolSupports('anthropic', 'TTS')).toBe(false)
    expect(protocolSupports('azure_speech', 'STT')).toBe(false)
    expect(protocolSupports('dashscope_native', 'VISION')).toBe(false)
    expect(protocolSupports('openai_compatible', 'VISION')).toBe(true)
    expect(protocolSupports('unknown', 'TTS')).toBe(false)
  })

  it('picks the model of the first supported requested capability', () => {
    expect(defaultModelFor('openai_compatible', ['STT'])).toBe('whisper-1')
    expect(defaultModelFor('dashscope_native', ['TRANSLATE'])).toBe('qwen-plus')
    expect(defaultModelFor('dashscope_native', ['TTS'])).toBe('qwen-omni-turbo')
    // Anthropic cannot do TTS → falls back to its own first capability.
    expect(defaultModelFor('anthropic', ['TTS'])).toBe('claude-haiku-4-5')
  })

  it('knows each API root and speech APIs without a model', () => {
    expect(defaultBaseUrlFor('anthropic')).toBe('https://api.anthropic.com')
    expect(defaultBaseUrlFor('elevenlabs_native')).toBe('https://api.elevenlabs.io/v1')
    expect(isModelUnused('azure_speech')).toBe(true)
    expect(isModelUnused('elevenlabs_native')).toBe(false)
  })

  it('drops capabilities a protocol cannot run', () => {
    expect(supportedSubset('anthropic', ['TEXT', 'TTS', 'VISION'])).toEqual(['TEXT', 'VISION'])
    expect(supportedSubset('google_speech', ['TRANSLATE'])).toEqual([])
  })
})
