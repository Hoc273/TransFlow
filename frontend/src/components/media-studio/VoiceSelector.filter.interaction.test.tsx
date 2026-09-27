// @vitest-environment jsdom
// Catalogs with N voices per language (Azure: up to 348 for "en"): the picker
// lists native voices per locale A→Z; multilingual voices of other locales are
// opt-in (they used to mix English/Chinese voices into a Korean list). Search +
// gender filters appear above VOICE_FILTER_THRESHOLD voices without ever
// dropping the selected voice from the <select>.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && 'shown' in o ? `${k}:${o.shown}/${o.total}` : k),
  }),
}))

const voicesByProvider = new Map<string, TtsVoice[]>()

vi.mock('@/hooks/useProviders', () => ({
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesByProvider.get(providerId) : undefined,
    isPending: false,
  }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

const { VoiceSelector } = await import('./VoiceSelector')

function voice(partial: Partial<TtsVoice>): TtsVoice {
  return {
    id: 'v1',
    voiceId: 'voice-1',
    language: 'vi-vn',
    languages: ['vi'],
    gender: 'FEMALE',
    displayName: 'Vais',
    isActive: true,
    cachedAt: null,
    ...partial,
  }
}

const provider: ProviderConfig = {
  id: 'p1',
  displayName: 'Azure Speech',
  protocol: 'azure_speech',
  capabilities: ['TTS'],
  defaultFor: [],
  baseUrl: 'https://southeastasia.tts.speech.microsoft.com',
  apiKeyHint: null,
  defaultModel: 'm',
  enabled: true,
}

const azureLike: TtsVoice[] = [
  voice({ id: 'hoaimy', voiceId: 'vi-VN-HoaiMyNeural', displayName: 'Hoài My', gender: 'FEMALE' }),
  voice({ id: 'namminh', voiceId: 'vi-VN-NamMinhNeural', displayName: 'Nam Minh', gender: 'MALE' }),
  ...Array.from({ length: 10 }, (_, i) => voice({
    id: `multi${i}`,
    voiceId: `en-US-Voice${i}MultilingualNeural`,
    language: 'en-us',
    languages: ['en', 'vi'],
    displayName: `Voice${i} Multilingual`,
    gender: i % 2 === 0 ? 'FEMALE' : 'MALE',
    status: i === 0 ? 'PREVIEW' : 'GA',
  })),
]

function renderSelector(selectedVoiceId?: string) {
  voicesByProvider.set('p1', azureLike)
  render(
    <VoiceSelector
      workspaceId="ws"
      providers={[provider]}
      targetLang="vi"
      selectedProviderId="p1"
      selectedVoiceId={selectedVoiceId}
      onChange={() => {}}
    />,
  )
  return screen.getByTestId('voice-voice-select') as HTMLSelectElement
}

const showMultilingual = () =>
  fireEvent.click(screen.getByTestId('voice-show-multilingual').querySelector('input')!)

const optionValues = (select: HTMLSelectElement) =>
  Array.from(select.querySelectorAll('option')).map((o) => o.value).filter(Boolean)

describe('VoiceSelector — N voices per language', () => {
  afterEach(() => cleanup())

  it('lists only native voices until multilingual ones are opted in', () => {
    const select = renderSelector()
    expect(optionValues(select)).toEqual(['hoaimy', 'namminh'])
    expect(select.querySelectorAll('optgroup')).toHaveLength(0)
    expect(screen.queryByTestId('voice-filter')).toBeNull()
    expect(screen.getByTestId('voice-show-multilingual')).toBeTruthy()
  })

  it('groups native voices first, then multilingual, and tags preview voices', () => {
    const select = renderSelector()
    showMultilingual()
    const groups = Array.from(select.querySelectorAll('optgroup'))
    expect(groups.map((g) => g.label)).toHaveLength(2)
    expect(groups[1].label).toBe('media:voice.multilingualGroup')
    expect(Array.from(groups[0].querySelectorAll('option')).map((o) => o.value)).toEqual(['hoaimy', 'namminh'])
    expect(groups[1].querySelector('option[value="multi0"]')?.textContent).toContain('media:voice.previewTag')
    expect(screen.getByTestId('voice-filter-count').textContent).toBe('media:voice.filterCount:12/12')
  })

  it('narrows the list by accent-insensitive search and by gender', () => {
    const select = renderSelector()
    showMultilingual()
    fireEvent.change(screen.getByTestId('voice-filter-search'), { target: { value: 'hoai' } })
    expect(optionValues(select)).toEqual(['hoaimy'])

    fireEvent.change(screen.getByTestId('voice-filter-search'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('voice-filter-gender-MALE'))
    expect(optionValues(select)).toEqual(['namminh', 'multi1', 'multi3', 'multi5', 'multi7', 'multi9'])
  })

  it('keeps the selected voice in the select while filters hide the rest', () => {
    const select = renderSelector('hoaimy')
    showMultilingual()
    fireEvent.change(screen.getByTestId('voice-filter-search'), { target: { value: 'no-such-voice' } })
    expect(optionValues(select)).toEqual(['hoaimy'])
    expect(select.value).toBe('hoaimy')
    expect(screen.getByTestId('voice-filter-count').textContent).toBe('media:voice.noFilterMatch')
  })

  it('hides the filter bar for small catalogs', () => {
    voicesByProvider.set('p1', azureLike.slice(0, 2))
    render(
      <VoiceSelector workspaceId="ws" providers={[provider]} targetLang="vi" selectedProviderId="p1" onChange={() => {}} />,
    )
    expect(screen.queryByTestId('voice-filter')).toBeNull()
  })
})
