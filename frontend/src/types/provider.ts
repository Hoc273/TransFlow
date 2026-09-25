export type ProviderProtocol =
  | 'openai_compatible'
  | 'anthropic'
  | 'elevenlabs_native'
  | 'azure_speech'
  | 'google_speech'
  | 'amazon_polly'
  | 'dashscope_native'
  /** Local Piper TTS runtime — zero-key system-provided provider row (ADR-CEP Phase A). */
  | 'local_piper'

/** How the UI should obtain TTS voices for a protocol. */
export type VoiceDiscoveryStrategy =
  | 'AUTO'
  | 'STATIC'
  | 'MANUAL'
  | 'UNSUPPORTED'
  /** @deprecated use AUTO */
  | 'QUERY'
  /** @deprecated use UNSUPPORTED / MANUAL */
  | 'NONE'

export type ProviderCapability =
  | 'TEXT'
  | 'STT'
  | 'TTS'
  | 'EMBEDDING'
  | 'VISION'
  | 'IMAGE'
  | 'VIDEO'

export type ProviderConfig = {
  id: string
  displayName: string
  protocol: ProviderProtocol
  capabilities: ProviderCapability[]
  /** Capabilities for which this provider is the workspace default. */
  defaultFor: ProviderCapability[]
  baseUrl: string
  /** Masked hint only — never the full key (BE `apiKeyHint`). */
  apiKeyHint: string | null
  defaultModel: string
  enabled: boolean
  /** LLM sampling temperature; STT/TTS ignore. Default 0.20. */
  temperature?: number | null
  /** Daily key check: DOWN = the provider rejected this key. */
  keyHealth?: 'UNKNOWN' | 'HEALTHY' | 'DOWN'
}

export type CreateProviderRequest = {
  displayName: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  defaultModel: string
  capabilities: ProviderCapability[]
  enabled: boolean
  defaultForCapabilities: ProviderCapability[]
  temperature?: number | null
}

export type UpdateProviderRequest = {
  displayName?: string
  protocol?: ProviderProtocol
  baseUrl?: string
  /** Omit / blank = keep existing key. */
  apiKey?: string
  defaultModel?: string
  capabilities?: ProviderCapability[]
  enabled?: boolean
  defaultForCapabilities?: ProviderCapability[]
  temperature?: number | null
}

export type ProviderDefaultRequest = {
  capability: ProviderCapability
}

export type TestConnectionResponse = {
  ok: boolean
  model: string | null
  message: string | null
  authSuccess?: boolean
  capabilityResults?: Array<{
    capability: string
    success: boolean
    model: string | null
    errorCode: string | null
    message: string | null
  }>
}

// ── 4-phase provider validation result (docs/07 §L, Q-PV-9) ──────────────

export type PhaseStatus = 'PASS' | 'FAIL' | 'SKIPPED'

export type OverallStatus = 'PASS' | 'FAIL'

export type PhaseResult = {
  status: PhaseStatus
  durationMs: number
  message: string | null
}

export type OptionalFeatureResult = {
  available: boolean
  detail: string | null
}

export type OptionalFeatures = {
  voiceDiscovery: OptionalFeatureResult
  modelDiscovery: OptionalFeatureResult
  streaming: OptionalFeatureResult
  toolCalling: OptionalFeatureResult
  realtime: OptionalFeatureResult
}

export type ProviderTestResult = {
  overall: OverallStatus
  capability: ProviderCapability
  connection: PhaseResult
  authentication: PhaseResult
  capabilityPhase: PhaseResult
  optionalFeatures: OptionalFeatures
}

export type TtsVoice = {
  id: string
  voiceId: string
  language: string
  /**
   * V39 — every normalized primary language code this voice is compatible
   * with (multilingual voices keep all of them). Absent on responses from
   * older backends → compatibility derives from `language` alone.
   */
  languages?: string[]
  gender: string
  displayName: string
  isActive: boolean
  cachedAt: string | null
  /** Owning provider row id (Phase C; absent on responses from older backends). */
  providerId?: string | null
}

/** One aggregated language entry of a provider's ACTIVE cached catalog. */
export type TtsVoiceLanguage = {
  /** Normalized primary BCP-47 code ("en", "vi", …). Canonical value — never a display name. */
  code: string
  /** Distinct active voices compatible with this code. */
  voiceCount: number
}

export type UpsertTtsVoiceRequest = {
  voiceId: string
  language: string
  gender: 'MALE' | 'FEMALE'
  displayName: string
}

export type VoicePreviewResponse = {
  audioUrl: string
  expiresInSeconds: number
}

export type ProviderPresetCategory = 'recommended' | 'openai_compatible'

export type StaticVoice = {
  voiceId: string
  language: string
  gender: string
  displayName: string
}

export type ProtocolAdapterMetadata = {
  /** Health check path appended to base URL (null if no health endpoint). */
  healthCheckPath: string | null
  /** API endpoint paths this protocol supports. */
  supportedEndpoints: string[]
  /**
   * Voice discovery strategy:
   * AUTO = live list API, STATIC = preset catalog, MANUAL = user enters Voice ID,
   * UNSUPPORTED = N/A. Legacy QUERY/NONE still accepted.
   */
  voiceDiscovery: VoiceDiscoveryStrategy
  /** Whether model discovery is supported via a list API (AUTO) or not. */
  modelDiscovery: VoiceDiscoveryStrategy
  /** Auth header name and value format. Multi-header auth uses comma-separated pairs,
   *  e.g. "x-api-key: {key}, anthropic-version: 2023-06-01". */
  authHeader: string
  /** Request body format, e.g. "openai_chat", "anthropic_messages", "dashscope_omni_chat". */
  requestFormat: string
  /** Response parsing strategy, e.g. "openai_stream", "elevenlabs_audio", "dashscope_omni_sse". */
  responseParser: string
  /** Static voice catalog when voiceDiscovery === 'STATIC'. */
  staticVoices?: StaticVoice[] | null
  /**
   * Default TTS voice for capability probes (Q-PV-14).
   * e.g. DashScope = Serena, OpenAI = alloy. Null when AUTO discovery or N/A.
   */
  defaultProbeVoice?: string | null
}

export type ProviderPreset = {
  id: string
  displayName: string
  protocol: ProviderProtocol
  baseUrl: string
  /** Fallback default model (first capability's model). See defaultModels for per-capability. */
  defaultModel: string
  /** Per-capability default model mapping (e.g. TEXT→gpt-4o-mini, STT→whisper-1). */
  defaultModels?: Record<string, string> | null
  capabilities: ProviderCapability[]
  category: ProviderPresetCategory
  /** e.g. bearer_api_key, x_api_key, google_oauth, subscription_key */
  authType?: string | null
  docsUrl?: string | null
  /** Protocol adapter metadata (null for presets without adapter info). */
  adapter?: ProtocolAdapterMetadata | null
}
