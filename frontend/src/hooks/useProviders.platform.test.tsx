// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()
vi.mock('@/lib/api/client', () => ({
  apiRequest: (path: string, init?: unknown) => apiRequest(path, init),
}))

import { useTtsProviderOptions, useTtsVoices } from '@/hooks/useProviders'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  apiRequest.mockReset()
})

describe('platform TTS keys for users without BYOK', () => {
  it('offers the shared platform keys when the user has no BYOK', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/users/me/providers') return Promise.resolve([])
      if (path === '/tts-voices/providers') {
        return Promise.resolve([{ id: 'plat-1', name: 'Pool TTS', protocol: 'openai_compatible' }])
      }
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    const { result } = renderHook(() => useTtsProviderOptions('ws-1'), { wrapper })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.data).toEqual([
      expect.objectContaining({ id: 'plat-1', displayName: 'Pool TTS', capabilities: ['TTS'], source: 'PLATFORM' }),
    ])
  })

  it('lists BYOK TTS keys before platform keys and drops non-TTS BYOK keys', async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path === '/users/me/providers') {
        return Promise.resolve([
          { id: 'own-tts', protocol: 'dashscope_native', capabilities: ['TTS'], baseUrl: 'x', apiKeyHint: null, defaultModel: 'm' },
          { id: 'own-llm', protocol: 'openai_compatible', capabilities: ['TRANSLATE'], baseUrl: 'x', apiKeyHint: null, defaultModel: 'm' },
        ])
      }
      if (path === '/tts-voices/providers') {
        return Promise.resolve([{ id: 'plat-1', name: 'Pool TTS', protocol: 'openai_compatible' }])
      }
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    const { result } = renderHook(() => useTtsProviderOptions('ws-1'), { wrapper })

    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(result.current.data.map((p) => p.id)).toEqual(['own-tts', 'plat-1'])
  })

  it('loads a platform key voices from /tts-voices, not from /users/me/providers', async () => {
    apiRequest.mockResolvedValue([{ id: 'v-1', voiceId: 'alloy', language: 'en-us', isActive: true }])

    const { result } = renderHook(() => useTtsVoices('ws-1', 'plat-1', 'PLATFORM'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiRequest).toHaveBeenCalledWith('/tts-voices?platformProviderId=plat-1', undefined)
  })

  it('keeps BYOK voices on /users/me/providers', async () => {
    apiRequest.mockResolvedValue([])

    const { result } = renderHook(() => useTtsVoices('ws-1', 'own-tts', undefined), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiRequest).toHaveBeenCalledWith('/users/me/providers/own-tts/voices', undefined)
  })
})
