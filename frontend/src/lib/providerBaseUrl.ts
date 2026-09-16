/**
 * Provider base URL normalize + validation helpers.
 * Protocol-aware: each protocol has specific URL expectations.
 * - OpenAI-compatible: expects URLs with /v1 or similar version path
 * - Anthropic: expects https://api.anthropic.com (NO /v1 suffix)
 * - ElevenLabs: expects https://api.elevenlabs.io/v1 (MUST include /v1)
 * - Azure Speech: expects https://{region}.tts.speech.microsoft.com
 * - Google Speech: expects https://texttospeech.googleapis.com
 *
 * Rejects full endpoint paths (chat/completions, audio/speech, …)
 * and keeps only the API root.
 *
 * ⚠️ WARNING: FORBIDDEN_SUFFIXES/FORBIDDEN_LAST_SEGMENTS must stay
 * in sync with backend ProviderBaseUrlValidator.java.
 */

import type { ProviderProtocol } from '@/types/provider'

const FORBIDDEN_SUFFIXES = [
  '/chat/completions',
  '/messages',
  '/audio/speech',
  '/audio/transcriptions',
  '/embeddings',
  '/models',
  '/v1/chat/completions',
  '/v1/messages',
  '/v1/audio/speech',
  '/v1/audio/transcriptions',
  '/v1/embeddings',
  '/v1/models',
] as const

const FORBIDDEN_LAST_SEGMENTS = new Set([
  'completions',
  'speech',
  'transcriptions',
  'embeddings',
  'models',
  'messages',
])

/** Anthropic base URLs should NOT include /v1 — Anthropic API doesn't use it. */
const ANTHROPIC_FORBIDDEN_SUFFIXES = ['/v1', '/v1/']

/** ElevenLabs base URLs MUST include /v1 — without it, the API root is wrong. */
const ELEVENLABS_REQUIRED_PATH = '/v1'

export function normalizeProviderBaseUrl(raw: string): string {
  let url = raw.trim()
  while (url.endsWith('/')) url = url.slice(0, -1)
  return url
}

export type ProviderBaseUrlValidation =
  | { ok: true; value: string }
  | { ok: false; messageKey: string; suggestion?: string }

/**
 * Protocol-aware base URL validation.
 * If protocol is provided, applies protocol-specific checks in addition
 * to the generic forbidden-endpoint checks.
 */
export function validateProviderBaseUrl(
  raw: string,
  protocol?: ProviderProtocol,
): ProviderBaseUrlValidation {
  if (!raw.trim()) {
    return { ok: false, messageKey: 'settings:providers.validation.baseUrlRequired' }
  }

  const url = normalizeProviderBaseUrl(raw)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, messageKey: 'settings:providers.validation.baseUrlInvalid' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, messageKey: 'settings:providers.validation.baseUrlScheme' }
  }

  // ── Generic forbidden-endpoint checks (all protocols) ────────────────

  const lower = url.toLowerCase()
  for (const suffix of FORBIDDEN_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      let suggestion = url.slice(0, -suffix.length)
      while (suggestion.endsWith('/')) suggestion = suggestion.slice(0, -1)
      if (!suggestion) suggestion = 'https://api.openai.com/v1'
      return {
        ok: false,
        messageKey: 'settings:providers.validation.baseUrlEndpoint',
        suggestion,
      }
    }
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]?.toLowerCase()
  if (last && FORBIDDEN_LAST_SEGMENTS.has(last)) {
    const suggestionPath = segments.slice(0, -1).join('/')
    const suggestion = `${parsed.origin}${suggestionPath ? `/${suggestionPath}` : ''}`
    return {
      ok: false,
      messageKey: 'settings:providers.validation.baseUrlEndpoint',
      suggestion: suggestion || 'https://api.openai.com/v1',
    }
  }

  // ── Protocol-specific checks ──────────────────────────────────────────

  if (protocol === 'anthropic') {
    // Anthropic API uses https://api.anthropic.com directly — /v1 is NOT part of the base URL.
    // Reject URLs ending in /v1 for Anthropic.
    const lowerAnthropic = url.toLowerCase()
    for (const suffix of ANTHROPIC_FORBIDDEN_SUFFIXES) {
      if (lowerAnthropic.endsWith(suffix)) {
        const suggestion = url.slice(0, -suffix.length)
        return {
          ok: false,
          messageKey: 'settings:providers.validation.baseUrlAnthropicNoV1',
          suggestion,
        }
      }
    }
  }

  if (protocol === 'elevenlabs_native') {
    // ElevenLabs API requires /v1 in the base URL path.
    // https://api.elevenlabs.io → wrong (missing /v1)
    // https://api.elevenlabs.io/v1 → correct
    // https://api.elevenlabs.io/v1/chat/completions → wrong (endpoint path, caught above)
    const path = parsed.pathname.toLowerCase()
    if (!path.includes(ELEVENLABS_REQUIRED_PATH)) {
      // URL has no /v1 in path — suggest adding it
      // Normalize path: "/" becomes empty, strip trailing slash
      const normalizedPath = path === '/' ? '' : path.replace(/\/+$/, '')
      const suggestion = `${parsed.origin}${normalizedPath}${ELEVENLABS_REQUIRED_PATH}`
      return {
        ok: false,
        messageKey: 'settings:providers.validation.baseUrlElevenlabsRequiresV1',
        suggestion,
      }
    }
  }

  return { ok: true, value: url }
}
