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
  testProviderApi,
  updateProviderApi,
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

  it('list map isActive→enabled và TRANSLATE→TEXT', async () => {
    apiRequest.mockResolvedValueOnce([
      {
        id: 'p1',
        protocol: 'openai_compatible',
        capabilities: ['TRANSLATE', 'TTS', 'VISION'],
        baseUrl: 'https://api.openai.com/v1',
        apiKeyHint: 'sk-...abcd',
        defaultModel: 'gpt-4o-mini',
        isActive: false,
      },
    ])
    const [provider] = await listProvidersApi()
    expect(provider).toMatchObject({
      id: 'p1',
      capabilities: ['TEXT', 'TTS', 'VISION'],
      enabled: false,
      defaultFor: [],
      displayName: 'gpt-4o-mini',
    })
  })

  it('create gửi đúng payload backend (TEXT→TRANSLATE, không kèm field thừa)', async () => {
    apiRequest.mockResolvedValueOnce({ id: 'p1', protocol: 'openai_compatible', capabilities: ['TRANSLATE'] })
    await createProviderApi({
      displayName: 'x',
      protocol: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-x',
      defaultModel: 'gpt-4o-mini',
      capabilities: ['TEXT', 'STT'],
      enabled: true,
      defaultForCapabilities: [],
    })
    expect(apiRequest).toHaveBeenCalledWith('/users/me/providers', {
      method: 'POST',
      body: {
        protocol: 'openai_compatible',
        capabilities: ['TRANSLATE', 'STT'],
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-x',
        defaultModel: 'gpt-4o-mini',
      },
    })
  })

  it('update map enabled→isActive và bỏ apiKey rỗng', async () => {
    apiRequest.mockResolvedValueOnce({ id: 'p1', protocol: 'openai_compatible', capabilities: ['TTS'] })
    await updateProviderApi('p1', { apiKey: '', enabled: false, capabilities: ['TTS'] })
    expect(apiRequest).toHaveBeenCalledWith(
      '/users/me/providers/p1',
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ isActive: false, apiKey: undefined, capabilities: ['TTS'] }),
      }),
    )
  })

  it('test map success→ok', async () => {
    apiRequest.mockResolvedValueOnce({ success: true, message: 'Connected' })
    await expect(testProviderApi('p1')).resolves.toEqual({ ok: true, model: null, message: 'Connected' })
  })
})
