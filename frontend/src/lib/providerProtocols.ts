/**
 * What each provider protocol can actually run in the AI gateway, and the
 * endpoint / model a new key starts from.
 *
 * ⚠️ Capabilities must stay in sync with backend-ai `supported_capabilities`
 * and backend-main `ProviderProtocolCapabilities` (which rejects other combos).
 * Capabilities here use the UI name TEXT; the wire name is TRANSLATE.
 */
import type { ProviderCapability, ProviderProtocol } from '@/types/provider'

export type ProtocolCapability = Extract<ProviderCapability, 'TEXT' | 'STT' | 'TTS' | 'VISION'>

type ProtocolSpec = {
  capabilities: ProtocolCapability[]
  baseUrl: string
  /** Default model per capability; STT/TTS-only speech APIs ignore the model. */
  models: Partial<Record<ProtocolCapability, string>>
  /** Speech APIs pick the voice per job — the model field is only a label. */
  modelUnused?: boolean
}

export const PROVIDER_PROTOCOLS: Record<
  'openai_compatible' | 'anthropic' | 'dashscope_native' | 'elevenlabs_native' | 'azure_speech' | 'google_speech',
  ProtocolSpec
> = {
  openai_compatible: {
    capabilities: ['TEXT', 'STT', 'TTS', 'VISION'],
    baseUrl: 'https://api.openai.com/v1',
    // STT sends response_format=verbose_json (segment timings): whisper-1 supports it,
    // gpt-4o-transcribe does not.
    models: { TEXT: 'gpt-4o-mini', VISION: 'gpt-4o-mini', STT: 'whisper-1', TTS: 'tts-1' },
  },
  anthropic: {
    capabilities: ['TEXT', 'VISION'],
    baseUrl: 'https://api.anthropic.com',
    models: { TEXT: 'claude-haiku-4-5', VISION: 'claude-haiku-4-5' },
  },
  dashscope_native: {
    capabilities: ['TEXT', 'STT', 'TTS'],
    // Singapore keys: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: { TEXT: 'qwen-plus', STT: 'qwen-omni-turbo', TTS: 'qwen-omni-turbo' },
  },
  elevenlabs_native: {
    capabilities: ['TTS'],
    baseUrl: 'https://api.elevenlabs.io/v1',
    models: { TTS: 'eleven_multilingual_v2' },
  },
  azure_speech: {
    capabilities: ['TTS'],
    // The portal endpoint https://{region}.api.cognitive.microsoft.com is accepted too.
    baseUrl: 'https://southeastasia.tts.speech.microsoft.com',
    models: { TTS: 'azure-neural-tts' },
    modelUnused: true,
  },
  google_speech: {
    capabilities: ['TTS'],
    baseUrl: 'https://texttospeech.googleapis.com',
    models: { TTS: 'google-cloud-tts' },
    modelUnused: true,
  },
}

export const SELECTABLE_PROTOCOLS = Object.keys(PROVIDER_PROTOCOLS) as (keyof typeof PROVIDER_PROTOCOLS)[]

function spec(protocol: ProviderProtocol | string): ProtocolSpec | undefined {
  return (PROVIDER_PROTOCOLS as Record<string, ProtocolSpec | undefined>)[protocol]
}

export function protocolCapabilities(protocol: ProviderProtocol | string): ProtocolCapability[] {
  return spec(protocol)?.capabilities ?? []
}

export function protocolSupports(protocol: ProviderProtocol | string, capability: string): boolean {
  const cap = capability === 'TRANSLATE' ? 'TEXT' : capability
  return protocolCapabilities(protocol).includes(cap as ProtocolCapability)
}

export function defaultBaseUrlFor(protocol: ProviderProtocol | string): string {
  return spec(protocol)?.baseUrl ?? PROVIDER_PROTOCOLS.openai_compatible.baseUrl
}

/** Model for the first requested capability the protocol supports. */
export function defaultModelFor(protocol: ProviderProtocol | string, capabilities: readonly string[]): string {
  const s = spec(protocol)
  if (!s) return ''
  const cap =
    capabilities.map((c) => (c === 'TRANSLATE' ? 'TEXT' : c)).find((c) => s.capabilities.includes(c as ProtocolCapability)) ??
    s.capabilities[0]
  return s.models[cap as ProtocolCapability] ?? ''
}

export function isModelUnused(protocol: ProviderProtocol | string): boolean {
  return spec(protocol)?.modelUnused === true
}

/** The capabilities of {@code current} the protocol supports (may be empty). */
export function supportedSubset<T extends string>(protocol: ProviderProtocol | string, current: readonly T[]): T[] {
  return current.filter((c) => protocolSupports(protocol, c))
}
