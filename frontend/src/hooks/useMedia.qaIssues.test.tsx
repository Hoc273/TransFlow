// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { listQaIssues } = vi.hoisted(() => ({ listQaIssues: vi.fn() }))

vi.mock('@/api/segments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/segments')>()
  return { ...actual, listMediaJobQaIssuesApi: listQaIssues }
})

import { useMediaJobQaIssues } from './useMedia'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const blockingIssue = {
  id: 'qa-1',
  subtitleSegmentId: 'seg-1',
  issueType: 'subtitle_overlap',
  severity: 'CRITICAL',
  blockingActions: ['BLOCK_RENDER'],
  resolvedAt: null,
}

describe('useMediaJobQaIssues refreshKey', () => {
  it('refetches when the stage signature changes (issues written by the pipeline after mount)', async () => {
    listQaIssues.mockResolvedValueOnce([]).mockResolvedValue([blockingIssue])

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useMediaJobQaIssues('ws-1', 'job-1', undefined, key),
      { wrapper: createWrapper(), initialProps: { key: 'TRANSLATE:PROCESSING:|RENDER:PENDING:' } },
    )
    await waitFor(() => expect(result.current.data).toEqual([]))

    rerender({ key: 'TRANSLATE:COMPLETED:|RENDER:PENDING:QA_BLOCKED' })

    await waitFor(() => expect(result.current.data).toEqual([blockingIssue]))
  })
})
