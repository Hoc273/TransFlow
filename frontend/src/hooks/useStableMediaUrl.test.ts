// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useStableMediaUrl } from './useStableMediaUrl'

const signed = (key: string, sig: string) => `http://minio:9000/bucket/${key}?X-Amz-Signature=${sig}`

describe('useStableMediaUrl', () => {
  it('keeps the first presigned URL when a refetch only re-signs the same object', () => {
    const { result, rerender } = renderHook(({ url }) => useStableMediaUrl(url), {
      initialProps: { url: signed('source/a', 'one') },
    })
    rerender({ url: signed('source/a', 'two') })

    expect(result.current).toBe(signed('source/a', 'one'))
  })

  it('switches immediately when the object changes', () => {
    const { result, rerender } = renderHook(({ url }) => useStableMediaUrl(url), {
      initialProps: { url: signed('rendered/a.mp4', 'one') },
    })
    rerender({ url: signed('rendered/b.mp4', 'two') })

    expect(result.current).toBe(signed('rendered/b.mp4', 'two'))
  })

  it('refreshes before the held signature can expire', () => {
    let clock = 0
    const now = () => clock
    const { result, rerender } = renderHook(({ url }) => useStableMediaUrl(url, now), {
      initialProps: { url: signed('source/a', 'one') },
    })
    clock = 46 * 60 * 1000
    rerender({ url: signed('source/a', 'two') })

    expect(result.current).toBe(signed('source/a', 'two'))
  })
})
