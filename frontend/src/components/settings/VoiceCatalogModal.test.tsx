// @vitest-environment jsdom
// Voice catalog (API keys + platform admin): picking Korean must not list the
// English / Chinese multilingual voices that also read Korean; languages and
// voices are A→Z in the web language.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { TtsVoice } from '@/types/provider'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('@/hooks/useProviders', () => ({
  useVoicePreview: () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue({}) }),
}))

const { VoiceCatalogModal } = await import('./VoiceCatalogModal')

const v = (voiceId: string, language: string, languages: string[], displayName: string): TtsVoice => ({
  id: voiceId, voiceId, language, languages, gender: 'FEMALE', displayName, isActive: true, cachedAt: null,
})

const voices = [
  v('ko-KR-SunHiNeural', 'ko-kr', ['ko'], 'SunHi'),
  v('en-US-AvaMultilingualNeural', 'en-us', ['en', 'ko', 'zh'], 'Ava Multilingual'),
  v('zh-CN-XiaoxiaoMultilingualNeural', 'zh-cn', ['zh', 'ko'], 'Xiaoxiao Multilingual'),
  v('ko-KR-InJoonNeural', 'ko-kr', ['ko'], 'InJoon'),
  v('en-US-JennyNeural', 'en-us', ['en'], 'Jenny'),
]

const rowIds = () => screen.queryAllByTestId('voice-catalog-row').map((r) => r.getAttribute('data-voice-id'))

describe('VoiceCatalogModal', () => {
  afterEach(() => cleanup())

  it('lists languages A→Z in the web language', () => {
    render(<VoiceCatalogModal open onClose={() => {}} title="t" voices={voices} loading={false} />)
    const options = within(screen.getByTestId('voice-catalog-language')).getAllByRole('option')
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['', 'zh', 'en', 'ko'])
    expect(options[1].textContent).toContain('Chinese')
  })

  it('shows only Korean voices for Korean, A→Z, with multilingual ones opt-in', () => {
    render(<VoiceCatalogModal open onClose={() => {}} title="t" voices={voices} loading={false} />)
    fireEvent.change(screen.getByTestId('voice-catalog-language'), { target: { value: 'ko' } })
    expect(rowIds()).toEqual(['ko-KR-InJoonNeural', 'ko-KR-SunHiNeural'])

    fireEvent.click(screen.getByTestId('voice-catalog-show-multilingual'))
    expect(rowIds()).toEqual([
      'ko-KR-InJoonNeural',
      'ko-KR-SunHiNeural',
      'en-US-AvaMultilingualNeural',
      'zh-CN-XiaoxiaoMultilingualNeural',
    ])
  })

  it('searches ignoring case', () => {
    render(<VoiceCatalogModal open onClose={() => {}} title="t" voices={voices} loading={false} />)
    fireEvent.change(screen.getByTestId('voice-catalog-search'), { target: { value: 'JENNY' } })
    expect(rowIds()).toEqual(['en-US-JennyNeural'])
  })
})
