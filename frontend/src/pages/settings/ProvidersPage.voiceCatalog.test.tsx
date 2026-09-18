// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

// V39 follow-up — AI Provider voice catalog modal:
// Provider → Language (from the real cached catalog) → Voice, honest stale
// cache states, discovery-strategy-gated Refresh.

afterEach(() => {
  cleanup()
})

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workspaceId: 'ws' }),
}))

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: { currentWorkspace: { name: string } | null }) => unknown) =>
    selector ? selector({ currentWorkspace: { name: 'WS' } }) : { currentWorkspace: { name: 'WS' } },
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  RoleGuard: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

const { voicesData, languagesData } = vi.hoisted(() => ({
  voicesData: new Map<string, unknown[]>(),
  languagesData: new Map<string, unknown[]>(),
}))

function makeVoice(partial: Record<string, unknown>) {
  return {
    id: String(partial.id),
    voiceId: String(partial.voiceId),
    language: 'en',
    gender: 'FEMALE',
    displayName: '',
    isActive: true,
    ...partial,
  }
}

beforeEach(() => {
  voicesData.set('prov-eleven', [
    makeVoice({ id: 'v-rachel', voiceId: 'rachel', displayName: 'Rachel', language: 'en', languages: ['en'] }),
    makeVoice({ id: 'v-mai', voiceId: 'mai', displayName: 'Mai', language: 'vi', languages: ['vi'] }),
    makeVoice({
      id: 'v-poly',
      voiceId: 'poly',
      displayName: 'Polyglot',
      language: 'ja',
      languages: ['ja', 'vi'],
      gender: 'MALE',
    }),
  ])
  voicesData.set('prov-openai', [])
  languagesData.set('prov-eleven', [
    { code: 'en', voiceCount: 1 },
    { code: 'vi', voiceCount: 2 },
    { code: 'ja', voiceCount: 1 },
    // Stale aggregation entry (e.g. voices soft-disabled after a language
    // refresh) — exercises the honest none-for-language state.
    { code: 'ko', voiceCount: 1 },
  ])
  languagesData.set('prov-openai', [])
})

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    data: [
      {
        id: 'prov-eleven',
        displayName: 'ElevenLabs',
        protocol: 'elevenlabs_native',
        capabilities: ['TTS'],
        defaultFor: [],
        baseUrl: 'https://api.elevenlabs.io/v1',
        apiKeyHint: null,
        defaultModel: 'eleven_multilingual_v2',
        enabled: true,
      },
      {
        id: 'prov-openai',
        displayName: 'OpenAI Compatible',
        protocol: 'openai_compatible',
        capabilities: ['TEXT', 'TTS'],
        defaultFor: [],
        baseUrl: 'https://example.test/v1',
        apiKeyHint: null,
        defaultModel: 'tts-1',
        enabled: true,
      },
    ],
  }),
  usePresets: (_ws: string | undefined, category?: string) => ({
    // React-query shape — the page destructures { data }.
    data:
      category === 'recommended'
        ? [
            {
              id: 'preset-eleven',
              displayName: 'ElevenLabs',
              protocol: 'elevenlabs_native',
              capabilities: ['TTS'],
              adapter: { voiceDiscovery: 'AUTO' },
            },
          ]
        : [
            {
              id: 'preset-openai',
              displayName: 'OpenAI Compatible',
              protocol: 'openai_compatible',
              capabilities: ['TEXT', 'TTS'],
              adapter: { voiceDiscovery: 'MANUAL' },
            },
          ],
  }),
  useCreateProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteProvider: () => ({ isPending: false }),
  useSetDefaultProvider: () => ({ isPending: false, mutate: vi.fn() }),
  useValidateProvider: () => ({ isPending: false }),
  useRefreshTtsVoices: () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue([]) }),
  useUpsertTtsVoice: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesData.get(providerId) ?? [] : undefined,
    isLoading: false,
  }),
  useTtsVoiceLanguages: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? languagesData.get(providerId) ?? [] : [],
  }),
  useVoicePreview: () => ({ isPending: false, variables: null, mutateAsync: vi.fn() }),
}))

const { ProvidersPageInner } = await import('./ProvidersPage')

function renderPage() {
  return render(<ProvidersPageInner />)
}

/** Opens the voice catalog modal of the provider whose row mentions `name`. */
function openVoiceCatalog(name: string) {
  const button = screen
    .getAllByText('settings:providers.voices.action')
    .find((el) => el.closest('tr')?.textContent?.includes(name))
  expect(button).toBeTruthy()
  fireEvent.click(button!)
}

describe('ProvidersPage voice catalog — Provider → Language → Voice', () => {
  it('derives the language selector from the real catalog without an English default', () => {
    renderPage()
    openVoiceCatalog('ElevenLabs')

    const select = screen.getByTestId('voice-language-select') as HTMLSelectElement
    // '' = All languages — never a hardcoded English preselection when
    // multiple languages exist.
    expect(select.value).toBe('')
    const values = Array.from(select.options).map((option) => option.value)
    expect(values).toEqual(['', 'en', 'vi', 'ja', 'ko'])
  })

  it('filters voices to the selected language including multilingual matches', () => {
    const { container } = renderPage()
    openVoiceCatalog('ElevenLabs')

    fireEvent.change(screen.getByTestId('voice-language-select'), {
      target: { value: 'vi' },
    })

    const rows = Array.from(container.querySelectorAll('tbody tr'))
    const names = rows.map((row) => row.textContent ?? '')
    expect(names.some((text) => text.includes('Mai'))).toBe(true)
    // Multilingual voice matches through ANY stored compatibility code.
    expect(names.some((text) => text.includes('Polyglot'))).toBe(true)
    expect(names.some((text) => text.includes('Rachel'))).toBe(false)
  })

  it('shows the explicit none-for-language state instead of falling back to English', () => {
    renderPage()
    openVoiceCatalog('ElevenLabs')

    // Select the stale language whose cached rows are gone — the modal must
    // show the explicit empty-for-language state pointing at Refresh, never
    // a silent English fallback.
    fireEvent.change(screen.getByTestId('voice-language-select'), {
      target: { value: 'ko' },
    })

    const emptyState = screen.getByTestId('voices-none-for-language')
    expect(emptyState, emptyState.textContent).toBeTruthy()
    expect(emptyState.textContent).toContain('settings:providers.voices.noneForLanguage')
  })

  it('gates Refresh by the resolved discovery strategy', () => {
    renderPage()

    // ElevenLabs preset resolves AUTO → Refresh available.
    openVoiceCatalog('ElevenLabs')
    expect(screen.getByText('settings:providers.voices.refresh')).toBeTruthy()
    cleanup()

    // OpenAI-compatible resolves MANUAL → no dynamic refresh affordance.
    renderPage()
    openVoiceCatalog('OpenAI Compatible')
    expect(screen.queryByText('settings:providers.voices.refresh')).toBeNull()
  })
})
