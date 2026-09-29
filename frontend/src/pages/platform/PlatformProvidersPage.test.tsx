// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlatformProvidersPage } from './PlatformProvidersPage'
import type { PlatformProvider } from '@/types/platform'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
    i18n: { language: 'vi' },
  }),
}))

function key(partial: Partial<PlatformProvider>): PlatformProvider {
  return {
    id: 'k',
    name: 'Key',
    protocol: 'azure_speech',
    groupKey: 'azure_speech',
    capabilities: ['TTS'],
    baseUrl: 'https://eastus.api.cognitive.microsoft.com/',
    apiKeyHint: '…abcd',
    defaultModel: null,
    modelOverrides: {},
    isActive: true,
    priority: 100,
    weight: 1,
    tier: 'PAID',
    healthStatus: 'HEALTHY',
    coolingDown: false,
    lastCheckedAt: null,
    lastErrorCode: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: null,
    ...partial,
  }
}

const providers: PlatformProvider[] = [
  key({ id: 'az-1', name: 'Azure Speech' }),
  key({
    id: 'groq',
    name: 'Groq',
    protocol: 'openai_compatible',
    groupKey: 'openai_compatible@api.groq.com',
    capabilities: ['STT'],
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3',
  }),
  key({ id: 'az-2', name: 'Azure Speech #2', baseUrl: 'https://southeastasia.api.cognitive.microsoft.com/' }),
]

vi.mock('@/hooks/usePlatform', () => ({
  usePlatformProviders: () => ({ data: providers, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreatePlatformProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePlatformProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePlatformProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestPlatformProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSyncPlatformProviderVoices: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/components/settings/VoiceCatalogModal', () => ({ VoiceCatalogModal: () => null }))

vi.mock('@/hooks/useProviders', () => ({
  useTtsVoices: () => ({ data: [], refetch: vi.fn() }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PlatformProvidersPage />
    </MemoryRouter>,
  )
}

describe('PlatformProvidersPage key groups', () => {
  it('lists the keys of one vendor under one group header', () => {
    renderPage()

    const headers = document.querySelectorAll('tr.platform-group-row')
    expect(headers).toHaveLength(2)
    expect(within(headers[0] as HTMLElement).getByText('azure_speech')).toBeTruthy()
    expect(within(headers[0] as HTMLElement).getByText(/providers\.group\.keys:2/)).toBeTruthy()
    expect(within(headers[1] as HTMLElement).getByText('openai_compatible · api.groq.com')).toBeTruthy()

    const rows = [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
    const azure2 = rows.findIndex((text) => text.includes('Azure Speech #2'))
    const groq = rows.findIndex((text) => text.includes('Groq'))
    expect(azure2).toBeLessThan(groq)
  })

  it('adds a key to a group with every setting copied except the key', () => {
    renderPage()

    fireEvent.click(screen.getAllByText('providers.group.addKey')[0])

    expect((screen.getByDisplayValue('Azure Speech #3') as HTMLInputElement).value).toBe('Azure Speech #3')
    expect(screen.getByDisplayValue('https://eastus.api.cognitive.microsoft.com/')).toBeTruthy()
  })
})
