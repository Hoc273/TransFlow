import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/lib/api/client'
import { createProviderApi, listProvidersApi, normalizeProvider, testProviderApi, updateProviderApi } from './providers'

vi.mock('@/lib/api/client', () => ({ apiRequest: vi.fn() }))

const providerDto = {
  id: 'provider-1',
  protocol: 'dashscope_native' as const,
  capabilities: ['TRANSLATE', 'STT'],
  defaultForCapabilities: ['TRANSLATE'],
  baseUrl: 'https://dashscope.example',
  apiKeyHint: 'sk-...1234',
  defaultModel: 'qwen-plus',
  isActive: true,
}

describe('provider capability defaults wire mapping', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset())

  it('normalizes TRANSLATE default to frontend TEXT capability', () => {
    expect(normalizeProvider(providerDto).defaultFor).toEqual(['TEXT'])
  })

  it('forwards selected defaults on create', async () => {
    vi.mocked(apiRequest).mockResolvedValue(providerDto)

    await createProviderApi({
      displayName: 'DashScope',
      protocol: 'dashscope_native',
      baseUrl: providerDto.baseUrl,
      apiKey: 'key',
      defaultModel: 'qwen-plus',
      capabilities: ['TEXT', 'STT'],
      enabled: true,
      defaultForCapabilities: ['TEXT'],
    })

    expect(apiRequest).toHaveBeenCalledWith('/users/me/providers', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        capabilities: ['TRANSLATE', 'STT'],
        defaultForCapabilities: ['TRANSLATE'],
      }),
    }))
  })

  it('forwards selected defaults on update and lists them back', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(providerDto)
      .mockResolvedValueOnce([providerDto])

    const updated = await updateProviderApi('provider-1', { defaultForCapabilities: ['TEXT', 'STT'] })
    const listed = await listProvidersApi()

    expect(apiRequest).toHaveBeenNthCalledWith(1, '/users/me/providers/provider-1', expect.objectContaining({
      method: 'PUT',
      body: expect.objectContaining({ defaultForCapabilities: ['TRANSLATE', 'STT'] }),
    }))
    expect(updated.defaultFor).toEqual(['TEXT'])
    expect(listed[0].defaultFor).toEqual(['TEXT'])
  })

  it.each([
    ['TEXT', 'TRANSLATE'],
    ['STT', 'STT'],
  ] as const)('tests the requested %s capability', async (capability, wireCapability) => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, model: 'configured-model' })

    const result = await testProviderApi('provider-uuid', capability)

    expect(apiRequest).toHaveBeenCalledWith(
      `/users/me/providers/provider-uuid/test?capability=${wireCapability}`,
      { method: 'POST' },
    )
    expect(result.ok).toBe(true)
  })
})
