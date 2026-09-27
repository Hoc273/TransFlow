import { describe, it, expect } from 'vitest'
import { validateProviderBaseUrl, normalizeProviderBaseUrl } from './providerBaseUrl'
import type { ProviderProtocol } from '@/types/provider'

describe('normalizeProviderBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeProviderBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
  })

  it('strips multiple trailing slashes', () => {
    expect(normalizeProviderBaseUrl('https://api.openai.com/v1///')).toBe('https://api.openai.com/v1')
  })

  it('preserves URL without trailing slash', () => {
    expect(normalizeProviderBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('trims whitespace', () => {
    expect(normalizeProviderBaseUrl('  https://api.openai.com/v1  ')).toBe('https://api.openai.com/v1')
  })
})

describe('validateProviderBaseUrl', () => {
  // ── Generic (protocol-agnostic) tests ──────────────────────────────────

  it('accepts valid API root', () => {
    const result = validateProviderBaseUrl('https://api.openai.com/v1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('https://api.openai.com/v1')
  })

  it('rejects empty input', () => {
    const result = validateProviderBaseUrl('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messageKey).toBe('settings:providers.validation.baseUrlRequired')
  })

  it('rejects invalid URL', () => {
    const result = validateProviderBaseUrl('not-a-url')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messageKey).toBe('settings:providers.validation.baseUrlInvalid')
  })

  it('rejects non-http scheme', () => {
    const result = validateProviderBaseUrl('ftp://example.com')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messageKey).toBe('settings:providers.validation.baseUrlScheme')
  })

  it('rejects /chat/completions endpoint', () => {
    const result = validateProviderBaseUrl('https://api.openai.com/v1/chat/completions')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messageKey).toBe('settings:providers.validation.baseUrlEndpoint')
  })

  it('rejects /audio/speech endpoint', () => {
    const result = validateProviderBaseUrl('https://api.openai.com/v1/audio/speech')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.messageKey).toBe('settings:providers.validation.baseUrlEndpoint')
  })

  it('accepts compatible-mode root', () => {
    const result = validateProviderBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })

  // ── Anthropic protocol ─────────────────────────────────────────────────

  describe('Anthropic protocol', () => {
    const protocol: ProviderProtocol = 'anthropic'

    it('accepts correct base URL without /v1', () => {
      const result = validateProviderBaseUrl('https://api.anthropic.com', protocol)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe('https://api.anthropic.com')
    })

    it('rejects base URL with /v1 suffix', () => {
      const result = validateProviderBaseUrl('https://api.anthropic.com/v1', protocol)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.messageKey).toBe('settings:providers.validation.baseUrlAnthropicNoV1')
        expect(result.suggestion).toBe('https://api.anthropic.com')
      }
    })

    it('rejects base URL with /v1/ trailing slash', () => {
      const result = validateProviderBaseUrl('https://api.anthropic.com/v1/', protocol)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.messageKey).toBe('settings:providers.validation.baseUrlAnthropicNoV1')
      }
    })

    it('generic validation does NOT reject Anthropic /v1 (no protocol hint)', () => {
      // Without protocol, /v1 is valid for OpenAI-compatible providers
      const result = validateProviderBaseUrl('https://api.anthropic.com/v1')
      expect(result.ok).toBe(true)
    })
  })

  // ── ElevenLabs protocol ────────────────────────────────────────────────

  describe('ElevenLabs protocol', () => {
    const protocol: ProviderProtocol = 'elevenlabs_native'

    it('accepts correct base URL with /v1', () => {
      const result = validateProviderBaseUrl('https://api.elevenlabs.io/v1', protocol)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe('https://api.elevenlabs.io/v1')
    })

    it('rejects base URL without /v1', () => {
      const result = validateProviderBaseUrl('https://api.elevenlabs.io', protocol)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.messageKey).toBe('settings:providers.validation.baseUrlElevenlabsRequiresV1')
        expect(result.suggestion).toBe('https://api.elevenlabs.io/v1')
      }
    })

    it('generic validation does NOT reject ElevenLabs bare host (no protocol hint)', () => {
      const result = validateProviderBaseUrl('https://api.elevenlabs.io')
      expect(result.ok).toBe(true)
    })
  })

  // ── Protocol confusion prevention ──────────────────────────────────────

  describe('protocol confusion prevention', () => {
    it('openai_compatible with /v1 is accepted', () => {
      const result = validateProviderBaseUrl('https://api.openai.com/v1', 'openai_compatible')
      expect(result.ok).toBe(true)
    })

    it('openai_compatible without path is accepted', () => {
      const result = validateProviderBaseUrl('https://custom-llm.example.com', 'openai_compatible')
      expect(result.ok).toBe(true)
    })

    it('undefined protocol falls back to generic validation', () => {
      const result = validateProviderBaseUrl('https://api.anthropic.com/v1', undefined)
      expect(result.ok).toBe(true)
    })
  })
})
