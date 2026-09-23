// @vitest-environment jsdom
// C2 UX (docs/19 §1.8.2) — VoiceSelector preview button (showPreview): with a
// complete provider+voice pair the button is enabled and clicking it fires
// the preview mutation with the tts_voices row id + the target language
// (never the provider's voice key).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

const voicesByProvider = new Map<string, TtsVoice[]>()
const previewMutate = vi.fn()

vi.mock('@/hooks/useProviders', () => ({
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesByProvider.get(providerId) : undefined,
    isPending: false,
  }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: previewMutate }),
}))

const { VoiceSelector } = await import('./VoiceSelector')

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

describe('VoiceSelector — showPreview preview (C2 UX)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('previews by tts_voices row UUID when the provider key is Kai', () => {
    const voiceRowId = '11111111-1111-4111-8111-111111111111'
    voicesByProvider.set('p1', [voice({ id: voiceRowId, language: 'en', voiceId: 'Kai' })])
    previewMutate.mockResolvedValue({ audioUrl: 'x', expiresInSeconds: 60 })

    render(
      <VoiceSelector
        workspaceId="ws"
        providers={[provider({ id: 'p1' })]}
        targetLang="en"
        selectedProviderId="p1"
        selectedVoiceId={voiceRowId}
        showPreview
        onChange={() => {}}
      />,
    )

    const button = screen.getByTestId('voice-preview-button') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    fireEvent.click(button)

    expect(previewMutate).toHaveBeenCalledTimes(1)
    expect(previewMutate).toHaveBeenCalledWith({
      providerId: 'p1',
      voiceRowId,
      language: 'en', // target language drives the sample text
    })
  })

  it('stays disabled while the pair is incomplete', () => {
    voicesByProvider.set('p1', [voice({ id: 'vi1', language: 'vi' })])
    render(
      <VoiceSelector
        workspaceId="ws"
        providers={[provider({ id: 'p1' })]}
        targetLang="vi"
        selectedProviderId="p1"
        showPreview
        onChange={() => {}}
      />,
    )

    const button = screen.getByTestId('voice-preview-button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(previewMutate).not.toHaveBeenCalled()
  })

  it('locks TTS controls when keep-original is checked and unlocks them when cleared', () => {
    voicesByProvider.set('p1', [voice({ id: 'vi1', language: 'vi' })])
    const onChange = vi.fn()
    render(
      <VoiceSelector
        workspaceId="ws"
        providers={[provider({ id: 'p1' })]}
        targetLang="vi"
        selectedProviderId="p1"
        selectedVoiceId="vi1"
        allowOriginal
        showPreview
        onChange={onChange}
      />,
    )

    const original = screen.getByTestId('voice-keep-original') as HTMLInputElement
    const providerSelect = screen.getByTestId('voice-provider-select') as HTMLSelectElement
    const voiceSelect = screen.getByTestId('voice-voice-select') as HTMLSelectElement
    const previewButton = screen.getByTestId('voice-preview-button') as HTMLButtonElement

    expect(original.type).toBe('checkbox')
    expect(original.checked).toBe(false)
    expect(providerSelect.disabled).toBe(false)

    fireEvent.click(original)

    expect(onChange).toHaveBeenCalledWith({ providerId: null, voiceId: null })
    expect(original.checked).toBe(true)
    expect(providerSelect.disabled).toBe(true)
    expect(voiceSelect.disabled).toBe(true)
    expect(previewButton.disabled).toBe(true)

    fireEvent.click(original)
    expect(original.checked).toBe(false)
    expect(providerSelect.disabled).toBe(false)
  })
})
