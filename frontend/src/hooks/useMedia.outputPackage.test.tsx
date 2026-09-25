// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/types/api'

const { getOutputPackage, rerunRender, rerunStage } = vi.hoisted(() => ({
  getOutputPackage: vi.fn(),
  rerunRender: vi.fn(),
  rerunStage: vi.fn(),
}))

vi.mock('@/api/transformation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/transformation')>()
  return {
    ...actual,
    getOutputPackageApi: getOutputPackage,
    rerunTransformationRenderApi: rerunRender,
    rerunTransformationStageApi: rerunStage,
  }
})

import { useOutputPackage, useRerunRender, useRerunStage } from './useMedia'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: (failureCount) => failureCount < 2 },
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const outputPackage = {
  jobId: 'job-1',
  primaryVideoRef: 'transflow-media/rendered/job-1/video.mp4',
  primaryVideoDownloadUrl: 'https://storage.test/video.mp4',
  audioTracks: [],
  subtitleTracks: [],
  durationMs: 1000,
  checksumSha256: null,
  artifactPins: [],
}

describe('output-package cache lifecycle', () => {
  it.each(['render', 'stage'] as const)('%s rerun refetches output-package', async (kind) => {
    getOutputPackage.mockResolvedValue(outputPackage)
    rerunRender.mockResolvedValue({ id: 'job-1' })
    rerunStage.mockResolvedValue({ id: 'job-1' })

    const { result } = renderHook(
      () => ({
        output: useOutputPackage('ws-1', 'job-1', true),
        render: useRerunRender('ws-1', 'job-1'),
        stage: useRerunStage('ws-1', 'job-1'),
      }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(getOutputPackage).toHaveBeenCalledTimes(1))
    getOutputPackage.mockClear()

    await act(async () => {
      if (kind === 'render') {
        await result.current.render.mutateAsync(undefined)
      } else {
        await result.current.stage.mutateAsync('RENDER')
      }
    })

    await waitFor(() => expect(getOutputPackage).toHaveBeenCalledTimes(1))
  })

  it('does not retry output-package for HTTP 409', async () => {
    getOutputPackage.mockRejectedValue(
      new ApiError({ status: 409, code: '2902', message: 'Stage output is not ready' }),
    )

    const { result } = renderHook(() => useOutputPackage('ws-1', 'job-1', true), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(getOutputPackage).toHaveBeenCalledTimes(1)
  })
})
