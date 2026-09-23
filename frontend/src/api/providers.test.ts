import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  buildWorkspacePath: (ws: string, suffix = '') => `/workspaces/${ws}${suffix}`,
}))

const {
  createProviderApi,
  listProvidersApi,
  previewTtsVoiceApi,
} = await import('./providers')

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue([])
})

describe('providers user-scoped', () => {
  it('list gọi /users/me/providers đúng 1 lần, không fallback workspace khi lỗi', async () => {
    apiRequest.mockRejectedValueOnce(new Error('gone'))
    await expect(listProvidersApi()).rejects.toThrow('gone')
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith('/users/me/providers')
  })

  it('create gọi POST /users/me/providers đúng 1 lần', async () => {
    apiRequest.mockResolvedValueOnce({ id: 'p1' })
    await createProviderApi({
      displayName: 'OpenAI',
      protocol: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-x',
      defaultModel: 'gpt-4o-mini',
      capabilities: ['TEXT'],
      enabled: true,
      defaultForCapabilities: ['TEXT'],
    })
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith(
      '/users/me/providers',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('preview gọi POST /tts-voices/preview (không qua workspace)', async () => {
    apiRequest.mockResolvedValueOnce({ audioUrl: 'https://x/y.mp3', expiresInSeconds: 60 })
    await previewTtsVoiceApi({ voiceId: 'v1', text: 'Hello' })
    expect(apiRequest).toHaveBeenCalledWith(
      '/tts-voices/preview',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
