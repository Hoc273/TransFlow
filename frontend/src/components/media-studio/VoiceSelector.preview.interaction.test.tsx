// @vitest-environment jsdom
// C2 UX (docs/19 §1.8.2) — VoiceSelector preview button (showPreview): with a
// complete provider+voice pair the button is enabled and clicking it fires
// the preview mutation with the CATALOG voice id + the target language
// (never part of the create payload).
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

  it('enables the preview button on a complete pair and fires with catalog voice id + language', () => {
    voicesByProvider.set('p1', [voice({ id: 'vi1', language: 'en', voiceId: 'catalog-1' })])
    previewMutate.mockResolvedValue({ audioUrl: 'x', expiresInSeconds: 60 })

    render(
      <VoiceSelector
        workspaceId="ws"
        providers={[provider({ id: 'p1' })]}
        targetLang="en"
        selectedProviderId="p1"
        selectedVoiceId="vi1"
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
      voiceId: 'catalog-1', // catalog id — not the row id
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

  it('hides TTS controls when keep-original is chosen and restores them on AI dubbing', () => {
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
    const useTts = screen.getByTestId('voice-use-tts') as HTMLInputElement

    expect(original.type).toBe('radio')
    expect(original.checked).toBe(false)
    expect(useTts.checked).toBe(true)
    expect((screen.getByTestId('voice-provider-select') as HTMLSelectElement).disabled).toBe(false)

    fireEvent.click(original)

    expect(onChange).toHaveBeenCalledWith({ providerId: null, voiceId: null })
    expect(original.checked).toBe(true)
    expect(screen.queryByTestId('voice-provider-select')).toBeNull()
    expect(screen.queryByTestId('voice-voice-select')).toBeNull()
    expect(screen.queryByTestId('voice-preview-button')).toBeNull()

    fireEvent.click(useTts)
    expect(useTts.checked).toBe(true)
    expect((screen.getByTestId('voice-provider-select') as HTMLSelectElement).disabled).toBe(false)
  })
})
