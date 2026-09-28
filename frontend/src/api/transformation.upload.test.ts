import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/types/api'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  buildWorkspacePath: (workspaceId: string, suffix = '') => `/workspaces/${workspaceId}${suffix}`,
}))

const { uploadTransformationMediaApi } = await import('./transformation')

const SESSION = '/workspaces/ws/media/uploads/up-1'

type Call = { path: string; method?: string; body?: unknown }

/** Fake server: 4-byte chunks; `failChunk` lets a test inject per-chunk failures. */
function fakeServer(failChunk: (index: number, attempt: number) => unknown = () => undefined) {
  const calls: Call[] = []
  const attempts = new Map<number, number>()
  const received = new Map<number, Blob>()
  apiRequest.mockImplementation(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    if (path.endsWith('/media/uploads') && opts.method === 'POST') {
      return { uploadId: 'up-1', chunkSizeBytes: 4, totalChunks: 3, receivedChunks: 0 }
    }
    const chunk = path.match(/\/chunks\/(\d+)$/)
    if (chunk) {
      const index = Number(chunk[1])
      const attempt = (attempts.get(index) ?? 0) + 1
      attempts.set(index, attempt)
      const failure = failChunk(index, attempt)
      if (failure) throw failure
      received.set(index, opts.body as Blob)
      return { receivedChunks: received.size }
    }
    if (path.endsWith('/complete')) {
      return { id: 'asset-1', fileName: 'v.mp4', fileSizeBytes: 10, durationMs: 1000 }
    }
    return undefined
  })
  return { calls, attempts, received }
}

const file = new File(['0123456789'], 'v.mp4', { type: 'video/mp4' })

beforeEach(() => {
  apiRequest.mockReset()
  vi.useRealTimers()
})

describe('uploadTransformationMediaApi (chunked)', () => {
  it('starts a session, sends every chunk slice, then completes', async () => {
    const { calls, received } = fakeServer()
    const progress: number[] = []

    const res = await uploadTransformationMediaApi('ws', 'p', file, { name: 'Clip', onProgress: (p) => progress.push(p) })

    expect(calls[0]).toMatchObject({
      path: '/workspaces/ws/projects/p/media/uploads',
      method: 'POST',
      body: { fileName: 'v.mp4', fileSizeBytes: 10, contentType: 'video/mp4' },
    })
    expect([...received.keys()].sort()).toEqual([0, 1, 2])
    expect(await received.get(0)!.text()).toBe('0123')
    expect(await received.get(2)!.text()).toBe('89')
    expect(calls.at(-1)).toMatchObject({ path: `${SESSION}/complete`, method: 'POST', body: { name: 'Clip' } })
    expect(res).toMatchObject({ assetId: 'asset-1', documentId: 'asset-1', durationMs: 1000 })
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(100)
    expect(Math.max(...progress.slice(0, -1))).toBeLessThanOrEqual(99)
  })

  it('retries a chunk after a transient failure', async () => {
    vi.useFakeTimers()
    const { attempts } = fakeServer((index, attempt) =>
      index === 1 && attempt === 1 ? new ApiError({ status: 503, errorCode: 'SERVER_ERROR', code: 'SERVER_ERROR', message: 'x' }) : undefined,
    )

    const done = uploadTransformationMediaApi('ws', 'p', file)
    await vi.runAllTimersAsync()

    await expect(done).resolves.toMatchObject({ assetId: 'asset-1' })
    expect(attempts.get(1)).toBe(2)
  })

  it('retries complete after a proxy timeout instead of dropping the session', async () => {
    vi.useFakeTimers()
    const { calls } = fakeServer()
    const base = apiRequest.getMockImplementation()!
    let completes = 0
    apiRequest.mockImplementation(async (path: string, opts?: unknown) => {
      if (path.endsWith('/complete') && ++completes === 1) {
        throw new ApiError({ status: 524, errorCode: 'SERVER_ERROR', code: 'SERVER_ERROR', message: 'timeout' })
      }
      return base(path, opts)
    })

    const done = uploadTransformationMediaApi('ws', 'p', file)
    await vi.runAllTimersAsync()

    await expect(done).resolves.toMatchObject({ assetId: 'asset-1' })
    expect(completes).toBe(2)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('fails fast on a non-transient error and cancels the session', async () => {
    const { calls } = fakeServer((index) =>
      index === 0 ? new ApiError({ status: 400, errorCode: '2807', code: '2807', message: 'bad chunk' }) : undefined,
    )

    await expect(uploadTransformationMediaApi('ws', 'p', file)).rejects.toMatchObject({ status: 400 })
    expect(calls.some((c) => c.path.endsWith('/complete'))).toBe(false)
    expect(calls.at(-1)).toMatchObject({ path: SESSION, method: 'DELETE' })
  })

  it('stops and cancels the session when the caller aborts', async () => {
    const controller = new AbortController()
    const { calls } = fakeServer((index) => {
      if (index === 0) controller.abort()
      return undefined
    })

    await expect(
      uploadTransformationMediaApi('ws', 'p', file, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls.some((c) => c.path.endsWith('/complete'))).toBe(false)
    expect(calls.at(-1)).toMatchObject({ path: SESSION, method: 'DELETE' })
  })
})
