// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

afterEach(() => {
  cleanup()
})

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workspaceId: 'ws-test' }),
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

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    data: [
      {
        id: 'prov-openai-image',
        displayName: 'OpenAI DALL-E',
        protocol: 'openai_compatible',
        capabilities: ['IMAGE'],
        defaultFor: ['IMAGE'],
        baseUrl: 'https://api.openai.com/v1',
        apiKeyHint: 'sk-...',
        defaultModel: 'dall-e-3',
        enabled: true,
      },
      {
        id: 'prov-tts',
        displayName: 'ElevenLabs',
        protocol: 'elevenlabs_native',
        capabilities: ['TTS'],
        defaultFor: ['TTS'],
        baseUrl: 'https://api.elevenlabs.io/v1',
        apiKeyHint: null,
        defaultModel: 'eleven_multilingual_v2',
        enabled: true,
      },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePresets: (_ws: string | undefined, category?: string) => ({
    data:
      category === 'recommended'
        ? [
            {
              id: 'preset-openai',
              displayName: 'OpenAI',
              protocol: 'openai_compatible',
              baseUrl: 'https://api.openai.com/v1',
              defaultModel: 'gpt-4o-mini',
              defaultModels: {
                TEXT: 'gpt-4o-mini',
                IMAGE: 'dall-e-3',
              },
              capabilities: ['TEXT', 'IMAGE'],
              category: 'recommended',
            },
          ]
        : [],
  }),
  useCreateProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTestProvider: () => ({ isPending: false, mutate: vi.fn() }),
  useSetDefaultProvider: () => ({ isPending: false, mutate: vi.fn() }),
  useValidateProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRefreshTtsVoices: () => ({ isPending: false, mutateAsync: vi.fn().mockResolvedValue([]) }),
  useUpsertTtsVoice: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTtsVoices: () => ({ data: [], isLoading: false }),
  useTtsVoiceLanguages: () => ({ data: [], isLoading: false }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

import { ProvidersPageInner } from './ProvidersPage'

describe('ProvidersPage — Image Provider Capability', () => {
  it('renders Image Provider section without coming-soon badge and shows configured provider', () => {
    render(<ProvidersPageInner />)

    // Heading for Image Providers section
    expect(screen.getByText(/providers\.sectionImageTitle/)).toBeDefined()
    expect(screen.getByText(/providers\.sectionImageSubtitle/)).toBeDefined()

    // Configured image provider row is rendered
    expect(screen.getByText('OpenAI DALL-E')).toBeDefined()
    expect(screen.getByText('dall-e-3')).toBeDefined()
  })

  it('allows opening the Add Provider modal seeded with IMAGE capability and preset default model', () => {
    render(<ProvidersPageInner />)

    // Find the Add button specifically within the Image section
    const imageSection = screen.getByText(/providers\.sectionImageTitle/).closest('section')!
    const addBtn = within(imageSection).getByRole('button', { name: /providers\.add/i })
    expect(addBtn).toBeDefined()

    // Click the Add button in the Image section
    fireEvent.click(addBtn)

    // Modal opens
    expect(screen.getByText(/providers\.addTitle/)).toBeDefined()

    // Recommended preset OpenAI is visible since it has IMAGE capability
    const presetBtn = screen.getByRole('button', { name: 'OpenAI' })
    expect(presetBtn).toBeDefined()

    // Clicking OpenAI preset sets dall-e-3 for IMAGE capability
    fireEvent.click(presetBtn)
    const modelInput = screen.getByDisplayValue('dall-e-3')
    expect(modelInput).toBeDefined()
  })
})
